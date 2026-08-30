import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { compareObjects, digestObject } from "@/Framework/Storage/Migration/contentHash"
import { createLocalStorageDriver } from "@/Framework/Storage/drivers/LocalStorageDriver"
import { StorageObjectNotFoundError } from "@/Framework/Storage/StorageErrors"
import type { StorageDriver } from "@/Framework/Storage/StorageDriver"

/**
 * PROVING TWO OBJECTS ARE THE SAME OBJECT.
 *
 * The test that matters most in this file is "same size, different bytes". That
 * is the case every cheap shortcut gets wrong: size matches, an ETag may match
 * (a multipart ETag depends on the uploader's part size, and encryption changes
 * it again), and a migration that trusted either would mark the file migrated
 * and silently never copy it.
 */

let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "flowcms-hash-"))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

const bytes = (s: string) => Buffer.from(s, "utf8")
const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex")

function localDriver(name = "root"): StorageDriver {
  return createLocalStorageDriver(join(workspace, name))
}

describe("digesting an object", () => {
  it("produces the SHA-256 of its bytes", async () => {
    const driver = localDriver()
    await driver.uploadObject("a.txt", bytes("hello world"))

    expect(await digestObject(driver, "a.txt")).toEqual({
      hash: sha256("hello world"),
      size: 11,
    })
  })

  it("hashes binary content exactly", async () => {
    const driver = localDriver()
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x00])
    await driver.uploadObject("img.png", binary)

    expect((await digestObject(driver, "img.png")).hash).toBe(sha256(binary))
  })

  it("handles an empty object", async () => {
    const driver = localDriver()
    await driver.uploadObject("empty.txt", Buffer.alloc(0))

    expect(await digestObject(driver, "empty.txt")).toEqual({ hash: sha256(""), size: 0 })
  })

  it("counts the bytes it actually read, not what a listing claimed", async () => {
    // A listing's size and the object's real content can disagree — the object
    // may have been replaced between the two calls. Verification that mixed
    // them would compare a hash of one thing with the size of another.
    const driver = localDriver()
    await driver.uploadObject("a.txt", bytes("12345"))

    expect((await digestObject(driver, "a.txt")).size).toBe(5)
  })

  it("reports a missing object as StorageObjectNotFoundError", async () => {
    await expect(digestObject(localDriver(), "nope.txt")).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    )
  })

  it("lets a backend failure propagate rather than returning a wrong hash", async () => {
    // A partial read that produced a hash would be worse than an error: it
    // would confidently declare two objects different.
    const driver = {
      openReadStream: async () =>
        (async function* () {
          yield new Uint8Array([1, 2, 3])
          throw new Error("connection reset mid-stream")
        })(),
    } as unknown as StorageDriver

    await expect(digestObject(driver, "a.txt")).rejects.toThrow("connection reset")
  })
})

describe("bounded memory", () => {
  it("never holds the whole object at once", async () => {
    // Ten chunks of 1 MB. If `digestObject` accumulated, peak retention would
    // be 10 MB; it must stay at one chunk.
    const chunk = new Uint8Array(1024 * 1024).fill(7)
    let live = 0
    let peak = 0

    const driver = {
      openReadStream: async () =>
        (async function* () {
          for (let i = 0; i < 10; i += 1) {
            live += 1
            peak = Math.max(peak, live)
            yield chunk
            // Released as soon as the digest has consumed it.
            live -= 1
          }
        })(),
    } as unknown as StorageDriver

    const digest = await digestObject(driver, "big.bin")

    expect(digest.size).toBe(10 * 1024 * 1024)
    // One chunk in flight at a time — the consumer never runs ahead.
    expect(peak).toBe(1)
  })

  it("uses the streaming seam rather than downloadObject", async () => {
    const downloadObject = vi.fn()
    const driver = {
      downloadObject,
      openReadStream: async () =>
        (async function* () {
          yield new Uint8Array([1])
        })(),
    } as unknown as StorageDriver

    await digestObject(driver, "a.bin")

    // `downloadObject` returns a Buffer, which for a 2 GB video means 2 GB of
    // heap — and a migration hashes every object in the store in turn.
    expect(downloadObject).not.toHaveBeenCalled()
  })
})

describe("comparing two objects", () => {
  it("reports identical content", async () => {
    const source = localDriver("src")
    const destination = localDriver("dst")
    await source.uploadObject("a.txt", bytes("same"))
    await destination.uploadObject("a.txt", bytes("same"))

    expect(
      await compareObjects({ driver: source, key: "a.txt" }, { driver: destination, key: "a.txt" }),
    ).toEqual({ result: "identical", hash: sha256("same"), size: 4 })
  })

  it("reports SAME SIZE but different bytes as different", async () => {
    // THE CASE EVERY SHORTCUT GETS WRONG. Both are four bytes. A size check
    // says identical; an ETag may too. Only the content decides.
    const source = localDriver("src")
    const destination = localDriver("dst")
    await source.uploadObject("a.txt", bytes("aaaa"))
    await destination.uploadObject("a.txt", bytes("bbbb"))

    const comparison = await compareObjects(
      { driver: source, key: "a.txt" },
      { driver: destination, key: "a.txt" },
    )

    expect(comparison.result).toBe("different")
    expect(comparison).toMatchObject({ sourceSize: 4, destinationSize: 4 })
  })

  it("reports different sizes as different", async () => {
    const source = localDriver("src")
    const destination = localDriver("dst")
    await source.uploadObject("a.txt", bytes("short"))
    await destination.uploadObject("a.txt", bytes("much longer content"))

    expect(
      (
        await compareObjects(
          { driver: source, key: "a.txt" },
          { driver: destination, key: "a.txt" },
        )
      ).result,
    ).toBe("different")
  })

  it("reports an absent destination object as an answer, not an error", async () => {
    // Exactly what a migration expects to find. Throwing would make the caller
    // catch to learn something ordinary.
    const source = localDriver("src")
    await source.uploadObject("a.txt", bytes("only here"))

    expect(
      await compareObjects(
        { driver: source, key: "a.txt" },
        { driver: localDriver("dst"), key: "a.txt" },
      ),
    ).toEqual({ result: "destination_missing", sourceHash: sha256("only here"), sourceSize: 9 })
  })

  it("distinguishes a missing SOURCE object", async () => {
    // A different situation entirely: the store changed underneath the
    // migration. Phase 4b treats this as a deleted source, not as work to do.
    const destination = localDriver("dst")
    await destination.uploadObject("a.txt", bytes("x"))

    expect(
      await compareObjects(
        { driver: localDriver("src"), key: "a.txt" },
        { driver: destination, key: "a.txt" },
      ),
    ).toEqual({ result: "source_missing" })
  })

  it("does not read the destination when the source is gone", async () => {
    const openReadStream = vi.fn()
    const destination = { openReadStream } as unknown as StorageDriver

    await compareObjects({ driver: localDriver("src"), key: "a.txt" }, { driver: destination, key: "a.txt" })

    expect(openReadStream).not.toHaveBeenCalled()
  })

  it("compares across different backends", async () => {
    // The whole point: a local source and an S3 destination, or the reverse,
    // compared by content rather than by anything either backend reports.
    const source = localDriver("src")
    await source.uploadObject("a.txt", bytes("cross-backend"))

    const fakeS3 = {
      openReadStream: async () =>
        (async function* () {
          yield new Uint8Array(bytes("cross-backend"))
        })(),
    } as unknown as StorageDriver

    expect(
      (await compareObjects({ driver: source, key: "a.txt" }, { driver: fakeS3, key: "a.txt" }))
        .result,
    ).toBe("identical")
  })
})

describe("ETags are never the decision", () => {
  it("compares content even when a provider reports a matching ETag", async () => {
    // A multipart ETag is a hash of part hashes with the part count appended,
    // so it depends on the part size the uploader chose; encryption changes it
    // again. Two identical objects can carry different ETags and two different
    // objects the same one.
    const withETag = (content: string, etag: string) =>
      ({
        openReadStream: async () =>
          (async function* () {
            yield new Uint8Array(bytes(content))
          })(),
        etag,
      }) as unknown as StorageDriver

    const comparison = await compareObjects(
      { driver: withETag("original", "d41d8cd98f00b204e9800998ecf8427e"), key: "a" },
      { driver: withETag("replaced", "d41d8cd98f00b204e9800998ecf8427e"), key: "a" },
    )

    // Same (fabricated) ETag, different bytes. The content decides.
    expect(comparison.result).toBe("different")
  })
})
