import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  addToTotals,
  classifyDestinationOnly,
  classifySourceEntry,
  emptyTotals,
  isReadyForMigration,
} from "@/Framework/Storage/Migration/classification"
import { createLocalStorageDriver } from "@/Framework/Storage/drivers/LocalStorageDriver"
import type { StorageDriver, StorageEntry } from "@/Framework/Storage/StorageDriver"

/**
 * WHAT THE TWO SIDES DIFFER BY — decided, never acted on.
 *
 * Classification is a statement about the world. Nothing in this module writes,
 * because a function that both decided and acted would make "what would happen"
 * and "what happened" the same call, and the entire safety argument rests on
 * being able to see the first before choosing the second.
 */

let workspace: string
let source: StorageDriver
let destination: StorageDriver

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "flowcms-classify-"))
  source = createLocalStorageDriver(join(workspace, "src"))
  destination = createLocalStorageDriver(join(workspace, "dst"))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

const bytes = (s: string) => Buffer.from(s, "utf8")
const fileEntry = (key: string, size = 0): StorageEntry => ({
  key,
  kind: "file",
  size,
  lastModified: new Date(0),
})
const dirEntry = (key: string): StorageEntry => ({
  key,
  kind: "directory",
  size: 0,
  lastModified: new Date(0),
})

function classify(entry: StorageEntry, destinationKeys: string[], incompatible?: Map<string, string>) {
  return classifySourceEntry(entry, {
    source,
    destination,
    destinationKeys: new Set(destinationKeys),
    incompatible,
  })
}

describe("files", () => {
  it("is missing when the destination does not have the key", async () => {
    await source.uploadObject("a.txt", bytes("x"))

    expect(await classify(fileEntry("a.txt", 1), [])).toMatchObject({
      classification: "missing",
    })
  })

  it("is matching when the bytes are identical", async () => {
    await source.uploadObject("a.txt", bytes("same content"))
    await destination.uploadObject("a.txt", bytes("same content"))

    const result = await classify(fileEntry("a.txt"), ["a.txt"])

    expect(result.classification).toBe("matching")
    expect(result.sourceHash).toBe(result.destinationHash)
  })

  it("is CONFLICTING when the size matches and the bytes do not", async () => {
    // THE CASE EVERY SHORTCUT GETS WRONG. Same length, so a size check says
    // identical and a multipart ETag might too. Treating it as matching would
    // mark the file migrated and never copy it.
    await source.uploadObject("a.txt", bytes("aaaa"))
    await destination.uploadObject("a.txt", bytes("bbbb"))

    const result = await classify(fileEntry("a.txt", 4), ["a.txt"])

    expect(result.classification).toBe("conflicting")
    expect(result.sourceSize).toBe(result.destinationSize)
    // And it says so, because "same size" is the part that makes this
    // surprising to whoever has to resolve it.
    expect(result.detail).toMatch(/same size/i)
  })

  it("is conflicting when the sizes differ too", async () => {
    await source.uploadObject("a.txt", bytes("short"))
    await destination.uploadObject("a.txt", bytes("a much longer thing"))

    expect((await classify(fileEntry("a.txt"), ["a.txt"])).classification).toBe("conflicting")
  })

  it("records both hashes for a conflict, so it can be explained", async () => {
    await source.uploadObject("a.txt", bytes("one"))
    await destination.uploadObject("a.txt", bytes("two"))

    const result = await classify(fileEntry("a.txt"), ["a.txt"])

    expect(result.sourceHash).toBeTruthy()
    expect(result.destinationHash).toBeTruthy()
    expect(result.sourceHash).not.toBe(result.destinationHash)
  })

  it("treats a key that vanished between listing and read as missing", async () => {
    // The destination listing said it was there; the read said otherwise. It is
    // missing, which is the state it is actually in.
    await source.uploadObject("a.txt", bytes("x"))

    expect((await classify(fileEntry("a.txt"), ["a.txt"])).classification).toBe("missing")
  })
})

describe("incompatible keys short-circuit", () => {
  it("classifies as incompatible without reading either side", async () => {
    const openReadStream = vi.fn()
    const spySource = { openReadStream } as unknown as StorageDriver

    const result = await classifySourceEntry(fileEntry("posts/../escape.png"), {
      source: spySource,
      destination,
      destinationKeys: new Set(["posts/../escape.png"]),
      incompatible: new Map([["posts/../escape.png", "it contains a relative path segment"]]),
    })

    expect(result.classification).toBe("incompatible")
    // Not merely wasted work: the resulting "missing" would be misleading. It
    // is not missing, it is impossible.
    expect(openReadStream).not.toHaveBeenCalled()
  })

  it("carries the reason through for the operator's report", async () => {
    const result = await classify(fileEntry("CON"), [], new Map([["CON", "reserved on Windows"]]))

    expect(result.detail).toContain("reserved on Windows")
  })
})

describe("directories are compared logically", () => {
  it("matches an empty folder present on both sides", async () => {
    // A marker object on S3 and a real directory on a filesystem are not the
    // same bytes and are not supposed to be — they are the same FACT expressed
    // the way each backend expresses it. Hashing them would report every empty
    // folder as a conflict.
    expect((await classify(dirEntry("empty/"), ["empty/"])).classification).toBe("matching")
  })

  it("reports a folder the destination does not have as missing", async () => {
    expect((await classify(dirEntry("empty/"), [])).classification).toBe("missing")
  })

  it("never classifies a directory as conflicting", async () => {
    // There is no content to conflict over.
    for (const keys of [[], ["d/"]]) {
      expect((await classify(dirEntry("d/"), keys)).classification).not.toBe("conflicting")
    }
  })
})

describe("destination-only objects", () => {
  it("is classified, not treated as an error", () => {
    const result = classifyDestinationOnly(fileEntry("leftover.png", 12))

    expect(result.classification).toBe("destination_only")
    expect(result.destinationSize).toBe(12)
  })

  it("says it will not be touched and will become visible", () => {
    // The operator needs to know both halves: nothing is deleted, and it WILL
    // appear in their File Manager afterwards.
    const detail = classifyDestinationOnly(fileEntry("leftover.png")).detail ?? ""

    expect(detail).toMatch(/not be touched|will not/i)
    expect(detail).toMatch(/visible|File Manager/i)
  })
})

describe("readiness, per mode", () => {
  const totals = (over: Partial<ReturnType<typeof emptyTotals>>) => ({ ...emptyTotals(), ...over })

  it("is ready when everything already matches", () => {
    expect(isReadyForMigration(totals({ matching: 10 }), "copy").ready).toBe(true)
    expect(isReadyForMigration(totals({ matching: 10 }), "verify").ready).toBe(true)
  })

  it("is ready in COPY mode with files to copy", () => {
    // Missing files are the work. That is what the operator asked for.
    expect(isReadyForMigration(totals({ missing: 500 }), "copy").ready).toBe(true)
  })

  it("is BLOCKED in VERIFY mode with files missing", () => {
    // The operator said the files were already there. These are not. Copying
    // them quietly would answer a question they did not ask.
    const verdict = isReadyForMigration(totals({ missing: 1 }), "verify")

    expect(verdict.ready).toBe(false)
    expect(verdict.blockedBy).toContain("missing")
  })

  it("is blocked by a single incompatible key, in both modes", () => {
    // One is enough. A site whose images are 99% moved is a broken site.
    expect(isReadyForMigration(totals({ incompatible: 1, matching: 99999 }), "copy").ready).toBe(
      false,
    )
    expect(isReadyForMigration(totals({ incompatible: 1 }), "verify").ready).toBe(false)
  })

  it("is blocked by a single conflict, in both modes", () => {
    expect(isReadyForMigration(totals({ conflicting: 1 }), "copy").ready).toBe(false)
    expect(isReadyForMigration(totals({ conflicting: 1 }), "verify").ready).toBe(false)
  })

  it("is NOT blocked by destination-only objects", () => {
    // They are acknowledged before cutover, not resolved.
    expect(isReadyForMigration(totals({ destinationOnly: 100 }), "copy").ready).toBe(true)
    expect(isReadyForMigration(totals({ destinationOnly: 100 }), "verify").ready).toBe(true)
  })

  it("names everything that blocks, not just the first", () => {
    const verdict = isReadyForMigration(totals({ incompatible: 1, conflicting: 1 }), "copy")

    expect(verdict.blockedBy.sort()).toEqual(["conflicting", "incompatible"])
  })
})

describe("totals", () => {
  it("counts each classification into its own bucket", () => {
    let totals = emptyTotals()
    for (const c of ["missing", "missing", "matching", "conflicting", "destination_only", "incompatible"] as const) {
      totals = addToTotals(totals, c)
    }

    expect(totals).toEqual({
      missing: 2,
      matching: 1,
      conflicting: 1,
      destinationOnly: 1,
      incompatible: 1,
    })
  })

  it("starts at zero", () => {
    expect(emptyTotals()).toEqual({
      missing: 0,
      matching: 0,
      conflicting: 0,
      destinationOnly: 0,
      incompatible: 0,
    })
  })
})
