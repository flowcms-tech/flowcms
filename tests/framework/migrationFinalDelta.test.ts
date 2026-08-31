import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  computeFinalDelta,
  planReconciliation,
  verifyDestinationMatches,
  verifyOnlyBlockers,
  type BaselineEntry,
} from "@/Framework/Storage/Migration/finalDelta"
import { createLocalStorageDriver } from "@/Framework/Storage/drivers/LocalStorageDriver"
import type { StorageDriver } from "@/Framework/Storage/StorageDriver"

/**
 * WHAT CHANGED WHILE THE BASELINE WAS BEING COPIED.
 *
 * The source stays live during the baseline pass, so by the time it finishes
 * files have been added, replaced and deleted. This is the pass that finds them
 * — and it only means anything because it runs INSIDE the write lock, where
 * nothing new can start.
 *
 * The rule underneath every test here: only what THIS migration created may be
 * deleted. A destination object that predates the migration and happens to
 * share a key with a since-deleted source object is somebody else's file.
 */

let workspace: string
let source: StorageDriver
let destination: StorageDriver

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "flowcms-delta-"))
  source = createLocalStorageDriver(join(workspace, "src"))
  destination = createLocalStorageDriver(join(workspace, "dst"))
})

afterEach(() => {
  try {
    rmSync(workspace, { recursive: true, force: true })
  } catch {
    // Windows holds handles briefly.
  }
})

const bytes = (s: string) => Buffer.from(s, "utf8")
const sha = (s: string) => createHash("sha256").update(s).digest("hex")

function base(over: Partial<BaselineEntry> & { key: string }): BaselineEntry {
  return {
    kind: "file",
    sourceSize: null,
    sourceHash: null,
    createdByMigration: true,
    classification: "missing",
    ...over,
  }
}

describe("detecting what moved", () => {
  it("reports nothing when the source is untouched", async () => {
    await source.uploadObject("a.txt", bytes("stable"))

    const delta = await computeFinalDelta(source, [
      base({ key: "a.txt", sourceSize: 6, sourceHash: sha("stable") }),
    ])

    expect(delta.unchanged).toBe(1)
    expect(delta.added + delta.changed + delta.removed).toBe(0)
  })

  it("finds a file added after the baseline", async () => {
    await source.uploadObject("a.txt", bytes("old"))
    await source.uploadObject("brand-new.txt", bytes("new"))

    const delta = await computeFinalDelta(source, [
      base({ key: "a.txt", sourceSize: 3, sourceHash: sha("old") }),
    ])

    expect(delta.added).toBe(1)
    expect(delta.entries.find((e) => e.key === "brand-new.txt")?.change).toBe("added")
  })

  it("finds a file whose content changed at the same size", async () => {
    // The case a size check misses entirely.
    await source.uploadObject("a.txt", bytes("bbbb"))

    const delta = await computeFinalDelta(source, [
      base({ key: "a.txt", sourceSize: 4, sourceHash: sha("aaaa") }),
    ])

    expect(delta.changed).toBe(1)
  })

  it("finds a file whose size changed, without hashing it", async () => {
    // A different size proves difference outright; reading the object would be
    // wasted work on a large store.
    await source.uploadObject("a.txt", bytes("much longer now"))

    const delta = await computeFinalDelta(source, [
      base({ key: "a.txt", sourceSize: 3, sourceHash: sha("old") }),
    ])

    expect(delta.changed).toBe(1)
    expect(delta.entries[0].currentHash).toBeUndefined()
  })

  it("finds a file deleted after the baseline", async () => {
    const delta = await computeFinalDelta(source, [
      base({ key: "gone.txt", sourceSize: 1, sourceHash: sha("x") }),
    ])

    expect(delta.removed).toBe(1)
    expect(delta.entries[0].change).toBe("removed")
  })

  it("treats a baseline entry with no hash as changed rather than assuming", async () => {
    await source.uploadObject("a.txt", bytes("something"))

    const delta = await computeFinalDelta(source, [base({ key: "a.txt", sourceHash: null })])

    expect(delta.changed).toBe(1)
  })

  it("compares directories logically, not by content", async () => {
    await source.createDirectory("empty/")

    const delta = await computeFinalDelta(source, [base({ key: "empty/", kind: "directory" })])

    expect(delta.unchanged).toBe(1)
  })

  it("carries destination ownership through to the delta", async () => {
    const delta = await computeFinalDelta(source, [
      base({ key: "ours.txt", createdByMigration: true }),
      base({ key: "theirs.txt", createdByMigration: false }),
    ])

    expect(delta.entries.find((e) => e.key === "ours.txt")?.destinationOwned).toBe(true)
    expect(delta.entries.find((e) => e.key === "theirs.txt")?.destinationOwned).toBe(false)
  })
})

describe("the critical window is bounded", () => {
  it("stops once too much has changed", async () => {
    // Not a performance guard: every storage mutation in the application is
    // refused while this runs, so an unbounded delta is an unbounded outage.
    for (let i = 0; i < 20; i += 1) await source.uploadObject(`new-${i}.txt`, bytes("x"))

    const delta = await computeFinalDelta(source, [], { maxEntries: 5 })

    expect(delta.truncated).toBe(true)
  })

  it("turns a truncated delta into a blocker rather than a partial cutover", async () => {
    const plan = planReconciliation(
      { entries: [], added: 0, removed: 0, changed: 0, unchanged: 0, truncated: true },
      "copy",
    )

    expect(plan.blockers.length).toBeGreaterThan(0)
    expect(plan.blockers[0]).toMatch(/nothing was switched/i)
    // And it says what to do next.
    expect(plan.blockers[0]).toMatch(/run the migration again/i)
  })

  it("does not compute removals from a truncated scan", async () => {
    // A scan that stopped early has not seen the whole source, so anything
    // "missing" from it might simply not have been reached — deleting on that
    // basis would destroy live files.
    for (let i = 0; i < 20; i += 1) await source.uploadObject(`new-${i}.txt`, bytes("x"))

    const delta = await computeFinalDelta(source, [base({ key: "not-scanned-yet.txt" })], {
      maxEntries: 3,
    })

    expect(delta.truncated).toBe(true)
    expect(delta.removed).toBe(0)
  })
})

describe("copy-mode reconciliation", () => {
  const delta = (entries: Parameters<typeof planReconciliation>[0]["entries"]) => ({
    entries,
    added: entries.filter((e) => e.change === "added").length,
    removed: entries.filter((e) => e.change === "removed").length,
    changed: entries.filter((e) => e.change === "changed").length,
    unchanged: entries.filter((e) => e.change === "unchanged").length,
    truncated: false,
  })

  it("plans to copy what was added and what changed", () => {
    const plan = planReconciliation(
      delta([
        { key: "new.txt", kind: "file", change: "added", destinationOwned: false },
        { key: "edited.txt", kind: "file", change: "changed", destinationOwned: true },
        { key: "same.txt", kind: "file", change: "unchanged", destinationOwned: true },
      ]),
      "copy",
    )

    expect(plan.copy.map((e) => e.key).sort()).toEqual(["edited.txt", "new.txt"])
  })

  it("removes a stale destination object THIS migration created", () => {
    const plan = planReconciliation(
      delta([{ key: "ours.txt", kind: "file", change: "removed", destinationOwned: true }]),
      "copy",
    )

    expect(plan.remove.map((e) => e.key)).toEqual(["ours.txt"])
  })

  it("NEVER removes a destination object that predates the migration", () => {
    // The reason `createdByMigration` is persisted at all. This object shares a
    // key with a since-deleted source object and is somebody else's file.
    const plan = planReconciliation(
      delta([{ key: "theirs.txt", kind: "file", change: "removed", destinationOwned: false }]),
      "copy",
    )

    expect(plan.remove).toEqual([])
    expect(plan.retainAsExtra.map((e) => e.key)).toEqual(["theirs.txt"])
  })

  it("keeps the two apart in one delta", () => {
    const plan = planReconciliation(
      delta([
        { key: "ours.txt", kind: "file", change: "removed", destinationOwned: true },
        { key: "theirs.txt", kind: "file", change: "removed", destinationOwned: false },
      ]),
      "copy",
    )

    expect(plan.remove.map((e) => e.key)).toEqual(["ours.txt"])
    expect(plan.retainAsExtra.map((e) => e.key)).toEqual(["theirs.txt"])
  })

  it("plans nothing at all when nothing changed", () => {
    const plan = planReconciliation(
      delta([{ key: "same.txt", kind: "file", change: "unchanged", destinationOwned: true }]),
      "copy",
    )

    expect(plan.copy).toEqual([])
    expect(plan.remove).toEqual([])
    expect(plan.blockers).toEqual([])
  })
})

describe("verify-only reconciliation repairs nothing", () => {
  const delta = (over: Partial<ReturnType<typeof emptyDelta>>) => ({ ...emptyDelta(), ...over })
  function emptyDelta() {
    return { entries: [], added: 0, removed: 0, changed: 0, unchanged: 0, truncated: false }
  }

  it("plans no copies and no removals, whatever changed", () => {
    const plan = planReconciliation(delta({ added: 3, changed: 2, removed: 1 }), "verify")

    expect(plan.copy).toEqual([])
    expect(plan.remove).toEqual([])
  })

  it("blocks on an added source file", () => {
    expect(verifyOnlyBlockers(delta({ added: 1 }))[0]).toMatch(/not copied/i)
  })

  it("blocks on a changed source file", () => {
    expect(verifyOnlyBlockers(delta({ changed: 1 }))[0]).toMatch(/older version/i)
  })

  it("reports a deleted source file without deleting the destination copy", () => {
    const reason = verifyOnlyBlockers(delta({ removed: 1 }))[0]

    expect(reason).toMatch(/left alone/i)
  })

  it("is silent when nothing changed", () => {
    expect(verifyOnlyBlockers(emptyDelta())).toEqual([])
  })
})

describe("final verification", () => {
  it("passes when every file matches by content", async () => {
    await source.uploadObject("a.txt", bytes("same"))
    await destination.uploadObject("a.txt", bytes("same"))

    const result = await verifyDestinationMatches(source, destination, [base({ key: "a.txt" })])

    expect(result.ok).toBe(true)
  })

  it("fails a same-size, different-content file", async () => {
    await source.uploadObject("a.txt", bytes("aaaa"))
    await destination.uploadObject("a.txt", bytes("bbbb"))

    const result = await verifyDestinationMatches(source, destination, [base({ key: "a.txt" })])

    expect(result.ok).toBe(false)
    expect(result.failures[0].reason).toMatch(/different content/i)
  })

  it("fails a file missing at the destination", async () => {
    await source.uploadObject("a.txt", bytes("x"))

    const result = await verifyDestinationMatches(source, destination, [base({ key: "a.txt" })])

    expect(result.ok).toBe(false)
    expect(result.failures[0].reason).toMatch(/missing/i)
  })

  it("checks an empty directory logically", async () => {
    await destination.createDirectory("empty/")

    const result = await verifyDestinationMatches(source, destination, [
      base({ key: "empty/", kind: "directory" }),
    ])

    expect(result.ok).toBe(true)
  })

  it("fails a missing empty directory", async () => {
    const result = await verifyDestinationMatches(source, destination, [
      base({ key: "empty/", kind: "directory" }),
    ])

    expect(result.ok).toBe(false)
    expect(result.failures[0].reason).toMatch(/folder is missing/i)
  })

  it("skips destination-only extras rather than failing on them", async () => {
    // They are acknowledged, not verified against a source that never had them.
    const result = await verifyDestinationMatches(source, destination, [
      base({ key: "extra.txt", classification: "destination_only" }),
    ])

    expect(result.ok).toBe(true)
  })

  it("reports every failure, not just the first", async () => {
    await source.uploadObject("a.txt", bytes("x"))
    await source.uploadObject("b.txt", bytes("y"))

    const result = await verifyDestinationMatches(source, destination, [
      base({ key: "a.txt" }),
      base({ key: "b.txt" }),
    ])

    expect(result.failures).toHaveLength(2)
  })
})
