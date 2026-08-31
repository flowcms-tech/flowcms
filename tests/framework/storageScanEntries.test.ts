import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ListObjectsV2Command } from "@aws-sdk/client-s3"
import { createLocalStorageDriver } from "@/Framework/Storage/drivers/LocalStorageDriver"
import type { StorageDriver, StorageEntry } from "@/Framework/Storage/StorageDriver"

/**
 * THE INVENTORY PRIMITIVE.
 *
 * `listObjects` paginates internally and then returns one array. That is fine
 * for a folder and exactly wrong for a migration: a store with half a million
 * objects would have to be held in memory in full before the first byte was
 * copied, and a restart would start again from nothing.
 *
 * `scanEntries` streams instead, in ascending key order, resumable from the
 * last key finished. These tests pin the three properties a migration depends
 * on: ORDER (so `after` means the same thing on both backends), RESUMABILITY,
 * and that DIRECTORIES ARE ENTRIES — an empty folder is a marker object on S3
 * and a real directory on a filesystem, and a migration that skipped them would
 * silently drop every empty folder an operator made.
 */

const bytes = (s: string) => Buffer.from(s, "utf8")

async function collect(driver: StorageDriver, after?: string): Promise<StorageEntry[]> {
  const out: StorageEntry[] = []
  for await (const entry of driver.scanEntries(after ? { after } : undefined)) out.push(entry)
  return out
}

// ---------------------------------------------------------------- local ----

describe("local scan", () => {
  let workspace: string
  let driver: StorageDriver

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "flowcms-scan-"))
    driver = createLocalStorageDriver(join(workspace, "root"))
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it("yields nothing for an empty store", async () => {
    expect(await collect(driver)).toEqual([])
  })

  it("yields every file, at every depth, in key order", async () => {
    await driver.uploadObject("b.txt", bytes("b"))
    await driver.uploadObject("a.txt", bytes("a"))
    await driver.uploadObject("posts/nested/deep.txt", bytes("d"))
    await driver.uploadObject("posts/one.txt", bytes("o"))

    expect((await collect(driver)).map((e) => e.key)).toEqual([
      "a.txt",
      "b.txt",
      "posts/nested/deep.txt",
      "posts/one.txt",
    ])
  })

  it("yields an empty directory as an entry", async () => {
    await driver.createDirectory("empty-folder/")

    expect(await collect(driver)).toEqual([
      expect.objectContaining({ key: "empty-folder/", kind: "directory", size: 0 }),
    ])
  })

  it("does not yield a directory that has files in it", async () => {
    // A non-empty folder needs no entry: it exists at the destination the
    // moment its files are written. Emitting one would create a redundant
    // marker object on an S3 destination for every folder in the store.
    await driver.uploadObject("posts/a.txt", bytes("a"))

    expect((await collect(driver)).map((e) => e.key)).toEqual(["posts/a.txt"])
  })

  it("reports size and kind for files", async () => {
    await driver.uploadObject("a.txt", bytes("12345"))

    expect(await collect(driver)).toEqual([
      expect.objectContaining({ key: "a.txt", kind: "file", size: 5 }),
    ])
  })

  it("resumes after a key, exclusively", async () => {
    for (const name of ["a.txt", "b.txt", "c.txt", "d.txt"]) {
      await driver.uploadObject(name, bytes("x"))
    }

    // Exclusive matters: "resume after the last key I finished" must not
    // re-process that key, and must not skip the next one.
    expect((await collect(driver, "b.txt")).map((e) => e.key)).toEqual(["c.txt", "d.txt"])
  })

  it("resuming from the final key yields nothing", async () => {
    await driver.uploadObject("only.txt", bytes("x"))

    expect(await collect(driver, "only.txt")).toEqual([])
  })

  it("handles unicode keys", async () => {
    await driver.uploadObject("файл.png", bytes("x"))
    await driver.uploadObject("日本語.png", bytes("x"))

    // Sorted on both sides: the scan promises ascending order, and asserting
    // one particular collation would pin a property this does not guarantee.
    expect((await collect(driver)).map((e) => e.key).sort()).toEqual(
      ["日本語.png", "файл.png"].sort(),
    )
  })

  it("never yields a symlink", async () => {
    // Consistent with the listing and read rules: a symlink is not part of
    // FlowCMS's storage, so a migration must not try to copy one.
    await driver.uploadObject("real.txt", bytes("x"))
    const root = join(workspace, "root")
    try {
      symlinkSync(join(workspace, "outside.txt"), join(root, "link.txt"), "file")
    } catch {
      return // unprivileged Windows; the guard is covered on CI
    }

    expect((await collect(driver)).map((e) => e.key)).toEqual(["real.txt"])
  })

  it("streams rather than materialising the store", async () => {
    for (let i = 0; i < 50; i += 1) {
      await driver.uploadObject(`f-${String(i).padStart(3, "0")}.txt`, bytes("x"))
    }

    // Taking two entries must not require walking all fifty. The iterator is
    // abandoned after two, which a function returning an array cannot support.
    const seen: string[] = []
    for await (const entry of driver.scanEntries()) {
      seen.push(entry.key)
      if (seen.length === 2) break
    }

    expect(seen).toEqual(["f-000.txt", "f-001.txt"])
  })

  it("survives a directory disappearing mid-scan", async () => {
    await driver.uploadObject("posts/a.txt", bytes("x"))
    mkdirSync(join(workspace, "root", "gone"), { recursive: true })

    const iterator = driver.scanEntries()[Symbol.asyncIterator]()
    rmSync(join(workspace, "root", "gone"), { recursive: true, force: true })

    // A store being migrated is a store still in use. A vanished entry is not
    // an error worth aborting an inventory over.
    await expect(iterator.next()).resolves.toBeDefined()
  })
})

// ------------------------------------------------------------------- s3 ----

describe("s3 scan", () => {
  const send = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    send.mockReset()
  })

  async function s3Driver(): Promise<StorageDriver> {
    const { createS3StorageDriver } = await import("@/Framework/Storage/drivers/S3StorageDriver")
    return createS3StorageDriver(async () => ({
      client: { send } as never,
      bucket: "b",
    }))
  }

  it("treats a key ending in a slash as a directory", async () => {
    send.mockResolvedValue({
      Contents: [
        { Key: "posts/", Size: 0 },
        { Key: "posts/a.png", Size: 9 },
      ],
      IsTruncated: false,
    })

    expect(await collect(await s3Driver())).toEqual([
      expect.objectContaining({ key: "posts/", kind: "directory" }),
      expect.objectContaining({ key: "posts/a.png", kind: "file", size: 9 }),
    ])
  })

  it("follows every page", async () => {
    send
      .mockResolvedValueOnce({
        Contents: [{ Key: "a", Size: 1 }],
        IsTruncated: true,
        NextContinuationToken: "t1",
      })
      .mockResolvedValueOnce({ Contents: [{ Key: "b", Size: 1 }], IsTruncated: false })

    expect((await collect(await s3Driver())).map((e) => e.key)).toEqual(["a", "b"])
  })

  it("resumes with StartAfter, which S3 treats exclusively", async () => {
    send.mockResolvedValue({ Contents: [], IsTruncated: false })

    await collect(await s3Driver(), "posts/b.png")

    const command = send.mock.calls[0][0] as ListObjectsV2Command
    expect(command.input.StartAfter).toBe("posts/b.png")
  })

  it("does not repeat StartAfter once paginating", async () => {
    // StartAfter and ContinuationToken together are ambiguous; the token
    // already encodes the position.
    send
      .mockResolvedValueOnce({
        Contents: [{ Key: "a", Size: 1 }],
        IsTruncated: true,
        NextContinuationToken: "t1",
      })
      .mockResolvedValueOnce({ Contents: [], IsTruncated: false })

    await collect(await s3Driver(), "start-here")

    const second = send.mock.calls[1][0] as ListObjectsV2Command
    expect(second.input.ContinuationToken).toBe("t1")
    expect(second.input.StartAfter).toBeUndefined()
  })

  it("scans the whole bucket, not one folder", async () => {
    send.mockResolvedValue({ Contents: [], IsTruncated: false })

    await collect(await s3Driver())

    const command = send.mock.calls[0][0] as ListObjectsV2Command
    // No delimiter: a migration wants every key, not one level.
    expect(command.input.Delimiter).toBeUndefined()
    expect(command.input.Prefix).toBeUndefined()
  })
})
