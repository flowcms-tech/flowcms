import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * THE SOURCE IS NEVER DELETED. NOT BY ANYTHING, EVER.
 *
 * This is the invariant the entire storage refactor rests on. A migration that
 * copies files is recoverable from any failure at any point, because whatever
 * went wrong, the originals are still where they were. The moment some future
 * change adds a "tidy up the old bucket" step, every other guarantee in Phase 4
 * becomes conditional on that step being correct — and it is the one step whose
 * bugs cannot be undone.
 *
 * So it is asserted STATICALLY, over the source of the migration modules,
 * rather than only behaviourally. A behavioural test proves that today's code
 * path did not delete anything; this proves there is no code path that could,
 * including one added by somebody who never read Phase 4's reasoning.
 *
 * WHAT IS DELIBERATELY ALLOWED, and why it is not a hole:
 *
 *   destination.deleteObject / deletePrefix   Only for objects THIS migration
 *                                             created, filtered on ownership by
 *                                             `planReconciliation`, and only at
 *                                             the destination.
 *
 *   driver.deleteObject in destinationTest    Removes the probe object it just
 *                                             wrote, at a candidate destination
 *                                             that is not active.
 */

const MIGRATION_DIR = "src/Framework/Storage/Migration"

function sourceFiles(root: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(root)) {
    const full = join(root, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

/**
 * Code with the prose removed.
 *
 * These files explain themselves at length, and several of those explanations
 * NAME the operations being forbidden — "no route can reach
 * `commitActiveStorage`" is a comment that would fail a search for
 * `commitActiveStorage`. Stripping comments is what makes the assertions about
 * behaviour rather than about vocabulary.
 */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
}

const MIGRATION_FILES = sourceFiles(MIGRATION_DIR)
const ALL_STORAGE_FILES = sourceFiles("src/Framework/Storage")

describe("nothing in the migration engine can delete from the source", () => {
  it.each(MIGRATION_FILES)("%s never calls a destructive method on `source`", (file) => {
    const source = code(file)

    // Matches `source.deleteObject(`, `source.deletePrefix(`, `source.renameX(`
    // and the `.source` property form. Comments mentioning them are fine — the
    // pattern requires a call.
    const destructive = /\bsource\s*\.\s*(deleteObject|deletePrefix|renameObject|renamePrefix|uploadObject|writeObjectStream|createDirectory|copyObject|copyPrefix)\s*\(/g

    expect([...source.matchAll(destructive)].map((m) => m[0])).toEqual([])
  })

  it("only ever deletes at the DESTINATION, and only what it owns", () => {
    // Every deletion in the whole migration subsystem, enumerated. If this list
    // grows, somebody has to say why in review.
    const deletions: string[] = []
    for (const file of MIGRATION_FILES) {
      const source = code(file)
      for (const match of source.matchAll(/(\w+)\s*\.\s*(deleteObject|deletePrefix)\s*\(/g)) {
        deletions.push(`${file.replace(/\\/g, "/")}: ${match[1]}.${match[2]}`)
      }
    }

    const receivers = new Set(deletions.map((d) => d.split(": ")[1].split(".")[0]))
    expect([...receivers].sort()).toEqual(["destination", "driver"])
  })

  it("removes a stale destination object only through the ownership filter", () => {
    // `planReconciliation` is the single place that decides what may be
    // removed, and it filters on `destinationOwned`. Anything bypassing it
    // would be deleting an object the migration never wrote.
    const plan = readFileSync(join(MIGRATION_DIR, "finalDelta.ts"), "utf8")

    expect(plan).toContain("remove: removed.filter((e) => e.destinationOwned)")
    expect(plan).toContain("retainAsExtra: removed.filter((e) => !e.destinationOwned)")
  })

  it("never clears the ownership flag once set", () => {
    // Losing it would either strand a stale destination object or license
    // deleting one the migration never owned.
    const repository = readFileSync(join(MIGRATION_DIR, "migrationRepository.ts"), "utf8")

    expect(repository).toContain("OWNERSHIP IS ONLY EVER SET, NEVER CLEARED")
    expect(repository).not.toMatch(/createdByMigration:\s*false\s*,?\s*\n\s*(?!.*default)/)
  })
})

describe("there is no cleanup, rollback or reverse-switch anywhere in storage", () => {
  const FORBIDDEN = [
    // Any of these appearing as an identifier would be a new capability, not a
    // refactor. Each is named because each was explicitly ruled out.
    /\bfunction\s+deleteOldStorage\b/,
    /\bfunction\s+emptySourceBucket\b/,
    /\bfunction\s+cleanupSource\b/,
    /\bfunction\s+rollbackCutover\b/,
    /\bfunction\s+revertStorage\b/,
    /\bfunction\s+switchBack\b/,
  ]

  it.each(ALL_STORAGE_FILES)("%s introduces no such operation", (file) => {
    const source = code(file)
    const found = FORBIDDEN.filter((pattern) => pattern.test(source)).map(String)

    expect(found).toEqual([])
  })

  it("keeps `commitActiveStorage` reachable from exactly one place", () => {
    // The only function in FlowCMS that moves the active topology. A second
    // caller would be a second way to relocate an installation, and the whole
    // point of the cutover transaction is that there is one.
    const callers = ALL_STORAGE_FILES.filter((file) => {
      if (file.endsWith("activeStorageStore.ts")) return false
      return /\bcommitActiveStorage\s*\(/.test(readFileSync(file, "utf8"))
    })

    expect(callers).toEqual([])
  })

  it("is not reachable from any API route either", () => {
    const routes = sourceFiles("src/app/api")
    const offenders = routes.filter((file) =>
      /\b(commitActiveStorage|acquireCutoverLock|commitCutover|computeFinalDelta)\s*\(/.test(
        code(file),
      ),
    )

    // Routes ask the service for a cutover; they never assemble one.
    expect(offenders).toEqual([])
  })
})

describe("destination extras are retained", () => {
  it("classifies them as untouchable rather than as work", () => {
    const classification = readFileSync(join(MIGRATION_DIR, "classification.ts"), "utf8")

    expect(classification).toContain("It will not be touched")
  })

  it("never lets a destination-only entry reach the delete plan", () => {
    // They are not "removed" entries at all: the delta only ever proposes
    // removing something that WAS at the source and no longer is.
    const delta = readFileSync(join(MIGRATION_DIR, "finalDelta.ts"), "utf8")

    expect(delta).toContain('const removed = delta.entries.filter((e) => e.change === "removed")')
  })
})
