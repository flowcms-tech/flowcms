import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { testDestination } from "@/Framework/Storage/Migration/destinationTest"
import type { StorageDriver } from "@/Framework/Storage/StorageDriver"

/**
 * PROVING A DESTINATION BEFORE ANYTHING DEPENDS ON IT.
 *
 * The failure this prevents is specific: credentials that can write but not
 * delete pass every superficial check, copy forty thousand objects
 * successfully, and then fail during final reconciliation — leaving an operator
 * with a full destination, a live source, and no idea which is authoritative.
 *
 * Each capability the migration will eventually need is therefore exercised
 * here, separately, so the failure names the missing one.
 */

let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "flowcms-dest-"))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const S3_CONFIG = {
  driver: "s3" as const,
  endpoint: "https://s3.example.com",
  region: "us-east-1",
  // Deliberately not a word that could appear in prose. Named "destination"
  // originally, which made the leak assertions below fire on the ordinary
  // English sentence "The destination could not be reached."
  bucket: "zzq-private-media-7f3a",
  accessKeyId: "AKIA",
  secretAccessKey: "secret",
}

/** A driver that succeeds at everything, with one step overridden to fail. */
function driverThatFails(step: keyof StorageDriver | null, error: unknown): StorageDriver {
  const store = new Map<string, Buffer>()
  const base: StorageDriver = {
    name: "s3",
    uploadObject: vi.fn(async (key: string, body: Buffer | Uint8Array) => {
      store.set(key, Buffer.from(body))
    }),
    downloadObject: vi.fn(async (key: string) => store.get(key) ?? Buffer.alloc(0)),
    deleteObject: vi.fn(async (key: string) => {
      store.delete(key)
    }),
    listObjects: vi.fn(async () => []),
    listDirectory: vi.fn(async () => ({ directories: [], files: [] })),
    createDirectory: vi.fn(async () => {}),
    deletePrefix: vi.fn(async () => {}),
    copyObject: vi.fn(async () => {}),
    renameObject: vi.fn(async () => {}),
    copyPrefix: vi.fn(async () => {}),
    renamePrefix: vi.fn(async () => {}),
    // Streaming scan. Not exercised by this file; present because the
    // contract requires it.
    scanEntries: async function* () {},
    // Bounded-memory read seam. Not exercised by this file; present because
    // the contract requires it.
    openReadStream: async () => (async function* () {})(),
    // Streaming write seam. Not exercised by this file; present because the
    // contract requires it.
    writeObjectStream: async () => {},
  }
  if (step) {
    ;(base as unknown as Record<string, unknown>)[step] = vi.fn(async () => {
      throw error
    })
  }
  return base
}

const awsError = (name: string, httpStatusCode?: number) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode } })

describe("a destination that works", () => {
  it("passes", async () => {
    const result = await testDestination(S3_CONFIG, {
      createDriver: () => driverThatFails(null, null),
    })

    expect(result).toEqual({ ok: true })
  })

  it("leaves nothing behind", async () => {
    const driver = driverThatFails(null, null)

    await testDestination(S3_CONFIG, { createDriver: () => driver })

    // Written, read, and removed. A probe that litters an operator's bucket
    // every time they press "Test connection" is a defect, not a diagnostic.
    expect(driver.uploadObject).toHaveBeenCalledTimes(1)
    expect(driver.deleteObject).toHaveBeenCalledTimes(1)
  })

  it("uses a key that cannot create a directory on a filesystem destination", async () => {
    const driver = driverThatFails(null, null)

    await testDestination(S3_CONFIG, { createDriver: () => driver })

    const key = (driver.uploadObject as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]
    // No slash: on S3 a slash is just a character, but on a filesystem it makes
    // a real directory that deleting the file leaves behind.
    expect(key).not.toContain("/")
    expect(key.startsWith(".")).toBe(true)
  })

  it("uses a different key every time, so concurrent tests cannot collide", async () => {
    const driver = driverThatFails(null, null)

    await testDestination(S3_CONFIG, { createDriver: () => driver })
    await testDestination(S3_CONFIG, { createDriver: () => driver })

    const calls = (driver.uploadObject as unknown as { mock: { calls: string[][] } }).mock.calls
    expect(calls[0][0]).not.toBe(calls[1][0])
  })
})

describe("each capability the migration needs is checked separately", () => {
  it.each([
    ["credentials rejected", "uploadObject", awsError("InvalidAccessKeyId", 403), "authentication_failed"],
    ["signature wrong", "uploadObject", awsError("SignatureDoesNotMatch"), "authentication_failed"],
    ["not allowed to write", "uploadObject", awsError("AccessDenied", 403), "permission_denied"],
    ["bucket absent", "uploadObject", awsError("NoSuchBucket", 404), "invalid_configuration"],
    ["write fails", "uploadObject", new Error("connection reset"), "write_failed"],
    ["read fails", "downloadObject", new Error("connection reset"), "read_failed"],
    ["delete fails", "deleteObject", awsError("AccessDenied", 403), "delete_failed"],
  ] as const)("reports %s", async (_label, step, error, expected) => {
    const result = await testDestination(S3_CONFIG, {
      createDriver: () => driverThatFails(step as keyof StorageDriver, error),
    })

    expect(result.ok).toBe(false)
    expect(result.failure).toBe(expected)
  })

  it("reports a destination that returns different bytes than were written", async () => {
    // Worse than a refusal, because a migration would call it success.
    const driver = driverThatFails(null, null)
    driver.downloadObject = vi.fn(async () => Buffer.from("something else entirely"))

    const result = await testDestination(S3_CONFIG, { createDriver: () => driver })

    expect(result.ok).toBe(false)
    expect(result.failure).toBe("content_mismatch")
  })

  it("cleans up after a content mismatch", async () => {
    const driver = driverThatFails(null, null)
    driver.downloadObject = vi.fn(async () => Buffer.from("wrong"))

    await testDestination(S3_CONFIG, { createDriver: () => driver })

    expect(driver.deleteObject).toHaveBeenCalled()
  })

  it("checks the delete rather than attempting it", async () => {
    // Final reconciliation removes the migration's own stale objects. A
    // destination that silently refuses deletes must fail HERE, not after
    // copying the entire store.
    const result = await testDestination(S3_CONFIG, {
      createDriver: () => driverThatFails("deleteObject", awsError("AccessDenied", 403)),
    })

    expect(result.failure).toBe("delete_failed")
  })
})

describe("local destinations", () => {
  it("passes for a writable directory, creating it if needed", async () => {
    const result = await testDestination({
      driver: "local",
      root: join(workspace, "not-created-yet"),
    })

    expect(result).toEqual({ ok: true })
  })

  it("reports a path that cannot be a directory", async () => {
    const occupied = join(workspace, "a-file")
    writeFileSync(occupied, "I am a file")

    const result = await testDestination({ driver: "local", root: join(occupied, "uploads") })

    expect(result.ok).toBe(false)
    expect(["path_unavailable", "path_unwritable", "write_failed"]).toContain(result.failure)
  })

  it.skipIf(process.platform === "win32")("reports an unwritable directory", async () => {
    // chmod is a no-op for the owner on Windows, so this only means anything on
    // a POSIX host — and it runs as a non-root user, which CI does.
    const readonly = join(workspace, "readonly")
    mkdirSync(readonly)
    chmodSync(readonly, 0o500)

    const result = await testDestination({ driver: "local", root: readonly })

    chmodSync(readonly, 0o700)
    expect(result.ok).toBe(false)
    expect(["path_unwritable", "write_failed"]).toContain(result.failure)
  })
})

describe("secrets never leak", () => {
  it.each([
    awsError("InvalidAccessKeyId", 403),
    awsError("AccessDenied", 403),
    new Error("connect ECONNREFUSED https://key:secret@internal.example.com"),
  ])("keeps the message free of configuration detail", async (error) => {
    const result = await testDestination(S3_CONFIG, {
      createDriver: () => driverThatFails("uploadObject", error),
    })

    const message = result.message ?? ""
    expect(message).not.toContain(S3_CONFIG.secretAccessKey)
    expect(message).not.toContain(S3_CONFIG.accessKeyId)
    expect(message).not.toContain(S3_CONFIG.bucket)
    expect(message).not.toContain("internal.example.com")
    // Raw exception text is where a credential hides; the message is written,
    // never forwarded.
    expect(message).not.toContain("ECONNREFUSED")
  })

  it("still says something useful", async () => {
    const result = await testDestination(S3_CONFIG, {
      createDriver: () => driverThatFails("uploadObject", awsError("AccessDenied", 403)),
    })

    expect(result.message).toMatch(/write|allowed|permission/i)
  })
})

describe("the active site is untouched", () => {
  it("never resolves the active driver", async () => {
    // The probe builds its own driver for the candidate configuration. If it
    // went through `resolveStorageDriver` it would be testing the CURRENT
    // storage and reporting the answer about a different one.
    const resolve = vi.fn()
    vi.doMock("@/Framework/Storage/resolveStorageDriver", () => ({ resolveStorageDriver: resolve }))

    await testDestination(S3_CONFIG, { createDriver: () => driverThatFails(null, null) })

    expect(resolve).not.toHaveBeenCalled()
  })
})
