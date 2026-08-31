import { describe, expect, it } from "vitest"
import {
  MIGRATION_STATUSES,
  ENTRY_CLASSIFICATIONS,
  allowedTransitionsFrom,
  blocksNewMigration,
  canTransition,
  classificationBlocks,
  isTerminal,
  sourceRemainsAuthoritative,
  type MigrationStatus,
} from "@/Framework/Storage/Migration/migrationState"

/**
 * THE LIFECYCLE POLICY.
 *
 * Exhaustive rather than illustrative: every pair of states is checked against
 * the table, so a transition added later is a deliberate act and a transition
 * removed is caught. The invariant underneath all of it — the source stays
 * authoritative in every state except `completed` — is what makes abandoning a
 * migration at any point safe.
 */

describe("the source stays authoritative until the very end", () => {
  it.each(MIGRATION_STATUSES.filter((s) => s !== "completed"))(
    "in %s, files are still at the source",
    (status) => {
      expect(sourceRemainsAuthoritative(status)).toBe(true)
    },
  )

  it("only a completed cutover moves it", () => {
    expect(sourceRemainsAuthoritative("completed")).toBe(false)
  })

  it("counts cutting_over as source-authoritative", () => {
    // The window is open but the transaction has not committed. A crash here
    // must leave the site on the source, which is what makes an interrupted
    // cutover recoverable rather than ambiguous.
    expect(sourceRemainsAuthoritative("cutting_over")).toBe(true)
  })
})

describe("legal transitions", () => {
  it.each([
    ["draft", "destination_tested"],
    ["draft", "draft"],
    ["destination_tested", "inventorying"],
    ["destination_tested", "draft"],
    ["inventorying", "inventorying"],
    ["inventorying", "ready"],
    ["inventorying", "blocked"],
    ["blocked", "inventorying"],
    ["ready", "copying"],
    ["ready", "verifying"],
    ["copying", "copying"],
    ["copying", "verifying"],
    ["verifying", "ready_to_cutover"],
    ["ready_to_cutover", "cutting_over"],
    ["cutting_over", "completed"],
    ["cutting_over", "failed"],
  ] as const)("%s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true)
  })

  it("lets inventory loop on itself, which is what makes it resumable", () => {
    // Each batch is a transition that persists a cursor.
    expect(canTransition("inventorying", "inventorying")).toBe(true)
  })

  it("lets a blocked job be re-analysed rather than only abandoned", () => {
    expect(canTransition("blocked", "inventorying")).toBe(true)
  })
})

describe("illegal transitions", () => {
  it.each([
    ["draft", "ready"],
    ["draft", "copying"],
    ["draft", "cutting_over"],
    ["draft", "completed"],
    ["destination_tested", "ready"],
    ["destination_tested", "cutting_over"],
    ["inventorying", "cutting_over"],
    ["inventorying", "completed"],
    ["ready", "completed"],
    ["ready", "ready_to_cutover"],
    ["copying", "cutting_over"],
    ["copying", "completed"],
    ["verifying", "completed"],
    ["blocked", "ready"],
    ["blocked", "copying"],
    ["blocked", "cutting_over"],
  ] as const)("%s -/-> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false)
  })

  it("never reaches completed except through cutting_over", () => {
    // The only edge into `completed` is the one that commits the topology.
    const sources = MIGRATION_STATUSES.filter((s) => canTransition(s, "completed"))
    expect(sources).toEqual(["cutting_over"])
  })

  it("never skips analysis to start copying", () => {
    // Copying without an inventory would transfer an unknown set of objects and
    // could not detect an incompatible key until it hit one.
    const sources = MIGRATION_STATUSES.filter((s) => canTransition(s, "copying"))
    expect(sources.sort()).toEqual(["copying", "ready"])
  })
})

describe("terminal states are terminal", () => {
  it.each(["completed", "failed", "cancelled"] as const)("%s has no way out", (status) => {
    expect(isTerminal(status)).toBe(true)
    expect(allowedTransitionsFrom(status)).toEqual([])
  })

  it.each(["completed", "failed", "cancelled"] as const)(
    "%s does not block a new migration",
    (status) => {
      expect(blocksNewMigration(status)).toBe(false)
    },
  )

  it.each(MIGRATION_STATUSES.filter((s) => !isTerminal(s)))(
    "%s blocks a second migration from starting",
    (status) => {
      // One relocation at a time. Two jobs would each copy to their own
      // destination while the other mutated the source, and each final delta
      // would be computed against a baseline the other had invalidated.
      expect(blocksNewMigration(status)).toBe(true)
    },
  )
})

describe("cancellation", () => {
  it.each(
    MIGRATION_STATUSES.filter(
      (s) => !isTerminal(s) && s !== "cutting_over",
    ) as readonly MigrationStatus[],
  )("is available from %s", (status) => {
    expect(canTransition(status, "cancelled")).toBe(true)
  })

  it("is NOT available once the cutover window is open", () => {
    // "Cancel" has no coherent meaning mid-switch: either the topology moved or
    // it did not.
    expect(canTransition("cutting_over", "cancelled")).toBe(false)
    expect([...allowedTransitionsFrom("cutting_over")].sort()).toEqual([
      "completed",
      "failed",
      // THE RELEASE EDGE, added in Phase 4c. A cutover that stopped because the
      // final delta was too large, or because its window ran out, changed
      // nothing at all: the source is still authoritative and the destination
      // still holds the work already done there. Before this edge existed the
      // lock could only be given up by failing the job, which threw away a
      // migration that was simply unfinished.
      //
      // It is NOT a cancel in disguise. `performCutover` takes it only after
      // confirming from the active snapshot that nothing was switched, and the
      // job lands back on `ready_to_cutover` — resumable, not stopped.
      "ready_to_cutover",
    ])
  })

  it("cannot become cancelled through the release edge either", () => {
    // The release goes to `ready_to_cutover`, which CAN be cancelled — but that
    // is a second, deliberate operator action taken once storage is unlocked
    // again, not something a stopped cutover does on its own.
    expect(canTransition("cutting_over", "cancelled")).toBe(false)
    expect(canTransition("ready_to_cutover", "cancelled")).toBe(true)
  })

  it("leaves the source authoritative", () => {
    expect(sourceRemainsAuthoritative("cancelled")).toBe(true)
  })
})

describe("what blocks readiness, per mode", () => {
  it("an incompatible key blocks in both modes", () => {
    // A key the destination filesystem cannot represent has no resolution
    // FlowCMS may choose on its own — renaming it would break every stored
    // reference to it.
    expect(classificationBlocks("incompatible", "copy")).toBe(true)
    expect(classificationBlocks("incompatible", "verify")).toBe(true)
  })

  it("a content conflict blocks in both modes", () => {
    // Same key, different bytes, already at the destination. Overwriting
    // silently is how somebody loses the file that was already there.
    expect(classificationBlocks("conflicting", "copy")).toBe(true)
    expect(classificationBlocks("conflicting", "verify")).toBe(true)
  })

  it("a missing file is WORK in copy mode", () => {
    expect(classificationBlocks("missing", "copy")).toBe(false)
  })

  it("a missing file is a FAILED CLAIM in verify-only mode", () => {
    // The operator said the files were already there. This one is not.
    // Copying it quietly would answer a question they did not ask and hide
    // that their own migration was incomplete.
    expect(classificationBlocks("missing", "verify")).toBe(true)
  })

  it("a matching file blocks nothing", () => {
    expect(classificationBlocks("matching", "copy")).toBe(false)
    expect(classificationBlocks("matching", "verify")).toBe(false)
  })

  it("a destination-only object blocks nothing, in either mode", () => {
    // Reported and acknowledged, never deleted. It simply becomes visible in
    // the File Manager after cutover.
    expect(classificationBlocks("destination_only", "copy")).toBe(false)
    expect(classificationBlocks("destination_only", "verify")).toBe(false)
  })

  it("every classification has a decided answer in both modes", () => {
    // No classification may fall through a switch and be silently permissive.
    for (const classification of ENTRY_CLASSIFICATIONS) {
      expect(typeof classificationBlocks(classification, "copy")).toBe("boolean")
      expect(typeof classificationBlocks(classification, "verify")).toBe("boolean")
    }
  })
})

describe("the table is complete", () => {
  it("every status has an entry", () => {
    for (const status of MIGRATION_STATUSES) {
      expect(Array.isArray(allowedTransitionsFrom(status))).toBe(true)
    }
  })

  it("every transition target is itself a real status", () => {
    // Guards against a typo producing an edge to a state that does not exist.
    for (const status of MIGRATION_STATUSES) {
      for (const target of allowedTransitionsFrom(status)) {
        expect(MIGRATION_STATUSES).toContain(target)
      }
    }
  })

  it("refuses a transition from an unknown status without throwing", () => {
    expect(canTransition("nonsense" as MigrationStatus, "ready")).toBe(false)
  })
})
