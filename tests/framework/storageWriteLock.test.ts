import { beforeEach, describe, expect, it, vi } from "vitest"
import { StorageWriteLockedError } from "@/Framework/Storage/storageWriteLock"
import type { StorageDriver } from "@/Framework/Storage/StorageDriver"

/**
 * THE WRITE GATE, AND WHERE IT LIVES.
 *
 * During the last moments of a cutover, storage must not be mutated through the
 * active driver: a file written between the final delta check and the topology
 * switch lands on the OLD location, is invisible at the new one, and nothing
 * afterwards ever looks for it again.
 *
 * The gate is in `StorageService`, not in the File Manager routes. The routes
 * are not the boundary — they are nine of the current callers, and a tenth
 * added later would arrive unguarded. That is exactly how the authorization gap
 * that `routePolicies.ts` exists to close happened in the first place.
 *
 * This file's real job is the LIST below: it enumerates every method and
 * asserts which side of the gate each one is on, so adding a mutating method
 * without gating it fails here.
 */

const verdict = vi.fn()
vi.mock("@/Framework/Storage/storageWriteLock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/Framework/Storage/storageWriteLock")>()
  return {
    ...actual,
    checkStorageWriteVerdict: () => verdict(),
    assertStorageWritable: async () => {
      const v = await verdict()
      if (v === "writable") return
      throw new actual.StorageWriteLockedError(v)
    },
  }
})

const resolveStorageDriver = vi.fn()
vi.mock("@/Framework/Storage/resolveStorageDriver", () => ({
  resolveStorageDriver: () => resolveStorageDriver(),
}))

const { StorageService } = await import("@/Framework/Storage/StorageService")

function fakeDriver(): StorageDriver {
  return {
    name: "s3",
    uploadObject: vi.fn(async () => {}),
    downloadObject: vi.fn(async () => Buffer.from("bytes")),
    deleteObject: vi.fn(async () => {}),
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
  }
}

let driver: StorageDriver

beforeEach(() => {
  driver = fakeDriver()
  resolveStorageDriver.mockReset().mockResolvedValue(driver)
  verdict.mockReset().mockResolvedValue("writable")
})

/** Everything that CHANGES stored bytes. All of these must be gated. */
const MUTATIONS: { method: string; args: unknown[] }[] = [
  { method: "uploadObject", args: ["a.png", Buffer.from("x"), "image/png"] },
  { method: "deleteObject", args: ["a.png"] },
  { method: "createDirectory", args: ["posts/"] },
  { method: "deletePrefix", args: ["posts/"] },
  { method: "copyObject", args: ["a.png", "b.png"] },
  { method: "renameObject", args: ["a.png", "b.png"] },
  { method: "copyPrefix", args: ["posts/", "archive/"] },
  { method: "renamePrefix", args: ["posts/", "archive/"] },
]

/** Everything that only READS. None of these may be gated. */
const READS: { method: string; args: unknown[] }[] = [
  { method: "downloadObject", args: ["a.png"] },
  { method: "listObjects", args: ["posts/"] },
  { method: "listDirectory", args: ["posts/"] },
]

function call(method: string, args: unknown[]) {
  return (StorageService as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[
    method
  ](...args)
}

describe("while a cutover holds the lock", () => {
  beforeEach(() => {
    verdict.mockResolvedValue("locked")
  })

  it.each(MUTATIONS)("$method is refused", async ({ method, args }) => {
    await expect(call(method, args)).rejects.toBeInstanceOf(StorageWriteLockedError)
  })

  it.each(MUTATIONS)("$method never reaches the driver", async ({ method, args }) => {
    // Refusing AFTER the write would be no protection at all.
    await call(method, args).catch(() => {})

    expect(driver[method as keyof StorageDriver]).not.toHaveBeenCalled()
  })

  it.each(READS)("$method still works", async ({ method, args }) => {
    // READS ARE NOT BLOCKED, deliberately. The public site keeps serving images
    // throughout a cutover; only the brief write window closes. A site that
    // went blank for the duration of a migration would be a worse outage than
    // the one this is preventing.
    await expect(call(method, args)).resolves.toBeDefined()
    expect(driver[method as keyof StorageDriver]).toHaveBeenCalled()
  })

  it("says how long to wait, so a client can retry rather than fail", async () => {
    const error = await StorageService.uploadObject("a.png", Buffer.from("x")).catch((e) => e)

    expect(error).toBeInstanceOf(StorageWriteLockedError)
    expect((error as StorageWriteLockedError).retryAfterSeconds).toBeGreaterThan(0)
  })

  it("explains itself without naming buckets or paths", async () => {
    const error = await StorageService.uploadObject("a.png", Buffer.from("x")).catch((e) => e)

    // The message reaches an ordinary editor trying to upload a picture.
    expect((error as Error).message).toMatch(/read-only|try again/i)
    expect((error as Error).message).not.toMatch(/bucket|endpoint|s3:\/\//i)
  })
})

describe("when the lock state cannot be read", () => {
  beforeEach(() => {
    // A database failure. The Phase 4 checkpoint failed OPEN here, letting
    // mutations through — and the one moment this answer matters most is a
    // cutover, which is writing to the database throughout. "I could not tell"
    // and "a cutover is running" must be treated the same.
    verdict.mockResolvedValue("unknown")
  })

  it.each(MUTATIONS)("$method is refused", async ({ method, args }) => {
    await expect(call(method, args)).rejects.toBeInstanceOf(StorageWriteLockedError)
  })

  it.each(MUTATIONS)("$method never reaches the driver", async ({ method, args }) => {
    await call(method, args).catch(() => {})
    expect(driver[method as keyof StorageDriver]).not.toHaveBeenCalled()
  })

  it.each(READS)("$method still works", async ({ method, args }) => {
    // Reads are untouched, so the public site keeps serving images even while
    // the database is unreachable and writes are declining.
    await expect(call(method, args)).resolves.toBeDefined()
  })

  it("distinguishes 'could not tell' from 'a cutover is running'", async () => {
    const error = await StorageService.uploadObject("a.png", Buffer.from("x")).catch((e) => e)

    expect((error as { verdict: string }).verdict).toBe("unknown")
    expect((error as Error).message).toMatch(/could not confirm/i)
  })

  it("still tells a client to retry rather than fail outright", async () => {
    const error = await StorageService.uploadObject("a.png", Buffer.from("x")).catch((e) => e)
    expect((error as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0)
  })
})

describe("when no cutover is running", () => {
  it.each([...MUTATIONS, ...READS])("$method passes through", async ({ method, args }) => {
    await call(method, args)

    expect(driver[method as keyof StorageDriver]).toHaveBeenCalled()
  })

  it("checks the lock once per mutation, not once per driver call", async () => {
    await StorageService.renamePrefix("posts/", "archive/")

    // `renamePrefix` is one logical mutation even though the S3 driver issues
    // many requests underneath. Gating per driver request would multiply the
    // cost for no extra safety.
    expect(verdict).toHaveBeenCalledTimes(1)
  })

  it("does not consult the lock for a read at all", async () => {
    await StorageService.downloadObject("a.png")

    expect(verdict).not.toHaveBeenCalled()
  })
})

describe("the gate covers the whole mutating surface", () => {
  it("accounts for every method StorageService exposes", () => {
    // The guard that makes this file self-maintaining: a new method added to
    // StorageService and to neither list fails here, forcing whoever added it
    // to decide whether it mutates.
    const exposed = Object.keys(StorageService).sort()
    const accounted = [...MUTATIONS, ...READS].map((entry) => entry.method).sort()

    expect(exposed).toEqual(accounted)
  })
})
