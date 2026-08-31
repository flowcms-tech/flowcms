import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StorageDriver } from "@/Framework/Storage/StorageDriver"

/**
 * The driver seam itself.
 *
 * `storageService.test.ts` proves the S3 driver still issues exactly the
 * commands it always did. This file proves the layer ABOVE it: that
 * `StorageService` really dispatches to whatever driver is resolved rather than
 * to S3 by another name, and that it behaves sanely when a driver does not
 * implement an optional capability.
 *
 * Without these, "there is an abstraction" would rest on the file layout alone —
 * and a facade that happened to keep calling S3 directly would look identical.
 */

/**
 * The write gate is not what this file tests, and since Phase 4a it FAILS
 * CLOSED — with no database here, the real gate would return "unknown" and
 * refuse every mutation. Declared writable so these assertions are about
 * dispatch. `storageWriteLock.test.ts` and `storageWriteLockPrimitive.test.ts`
 * cover the gate itself.
 */
vi.mock("@/Framework/Storage/storageWriteLock", () => ({
  assertStorageWritable: async () => {},
}))

const resolveStorageDriver = vi.fn()
vi.mock("@/Framework/Storage/resolveStorageDriver", () => ({
  resolveStorageDriver: () => resolveStorageDriver(),
}))

const { StorageService } = await import("@/Framework/Storage/StorageService")

/** A driver that records calls and implements every optional capability. */
function fakeDriver(overrides: Partial<StorageDriver> = {}): StorageDriver {
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
    // Streaming scan. Not exercised by this file; present because the contract
    // requires it.
    scanEntries: async function* () {},
    // Bounded-memory read seam. Not exercised by this file; present because
    // the contract requires it.
    openReadStream: async () => (async function* () {})(),
    // Streaming write seam. Not exercised by this file; present because the
    // contract requires it.
    writeObjectStream: async () => {},
    ...overrides,
  }
}

beforeEach(() => {
  resolveStorageDriver.mockReset()
})

describe("StorageService dispatches to the resolved driver", () => {
  /**
   * Every facade method, with the arguments it must hand through untouched.
   *
   * Table-driven because the failure this guards against is a single dropped
   * argument in one of twelve near-identical delegations — `contentType` not
   * being forwarded, say, which would silently store every upload as
   * `application/octet-stream` and break image rendering with no error
   * anywhere.
   */
  const cases: { method: string; args: unknown[] }[] = [
    { method: "uploadObject", args: ["posts/a.png", Buffer.from("x"), "image/png"] },
    { method: "downloadObject", args: ["posts/a.png"] },
    { method: "deleteObject", args: ["posts/a.png"] },
    { method: "listObjects", args: ["posts/"] },
    { method: "listDirectory", args: ["posts/"] },
    { method: "createDirectory", args: ["posts/2026/"] },
    { method: "deletePrefix", args: ["posts/"] },
    { method: "copyObject", args: ["posts/a.png", "archive/a.png"] },
    { method: "renameObject", args: ["posts/a.png", "posts/b.png"] },
    { method: "copyPrefix", args: ["posts/", "archive/"] },
    { method: "renamePrefix", args: ["posts/", "archive/"] },
  ]

  it.each(cases)("$method forwards its arguments to the driver", async ({ method, args }) => {
    const driver = fakeDriver()
    resolveStorageDriver.mockResolvedValue(driver)

    await (StorageService as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[
      method
    ](...args)

    expect(driver[method as keyof StorageDriver]).toHaveBeenCalledWith(...args)
  })

  it("resolves the driver again for every operation", async () => {
    resolveStorageDriver.mockResolvedValue(fakeDriver())

    await StorageService.deleteObject("a.png")
    await StorageService.deleteObject("b.png")

    // Nothing may memoise the driver in a module variable: an operator who
    // changes storage configuration has to be served by the next request, not
    // the next restart.
    expect(resolveStorageDriver).toHaveBeenCalledTimes(2)
  })

  it("returns the driver's own result rather than re-deriving one", async () => {
    const listing = {
      directories: ["posts/2026/"],
      files: [{ key: "posts/a.png", size: 4, lastModified: new Date(0) }],
    }
    resolveStorageDriver.mockResolvedValue(
      fakeDriver({ listDirectory: vi.fn(async () => listing) }),
    )

    expect(await StorageService.listDirectory("posts/")).toEqual(listing)
  })

  it("lets a driver's failure propagate untouched", async () => {
    resolveStorageDriver.mockResolvedValue(
      fakeDriver({
        uploadObject: vi.fn(async () => {
          throw new Error("S3 is not configured — set it in Admin")
        }),
      }),
    )

    // `checkStoragePrerequisite` classifies a deployment by matching on this
    // message, so the facade must not wrap, replace or swallow it.
    await expect(StorageService.uploadObject("a.png", Buffer.from("x"))).rejects.toThrow(
      "S3 is not configured",
    )
  })
})

// The real `resolveStorageDriver` is exercised in `storageService.test.ts`
// instead of here. It pulls in the genuine AWS SDK, and `vi.importActual` past
// this file's module mock made that a ~20-second import — close enough to the
// suite timeout to go flaky in CI. That file already mocks the SDK, so the same
// assertion costs nothing there.
