import { digestObject } from "./contentHash"
import { StorageObjectNotFoundError } from "../StorageErrors"
import type { MigrationMode } from "./migrationState"
import type { StorageDriver, StorageEntry } from "../StorageDriver"

/**
 * WHAT CHANGED WHILE THE BASELINE WAS BEING COPIED.
 *
 * The source stays live throughout the baseline pass — that is the whole point,
 * because locking storage for the duration of a large migration would be an
 * outage rather than a migration. The cost is that by the time the baseline
 * finishes, the source has moved on: files were uploaded, replaced and deleted.
 *
 * This runs INSIDE the write lock, and that ordering is the only reason its
 * answer is worth anything. Run before the lock, it would describe a source
 * that can still change; run after, nothing new can start, so what it sees is
 * what will be there at cutover.
 *
 * IT COMPARES AGAINST THE PERSISTED BASELINE, not against the destination. The
 * baseline is what the destination was built from, so "did the source change"
 * is exactly "does the source still match the baseline".
 */

export type DeltaKind = "added" | "removed" | "changed" | "unchanged"

export interface DeltaEntry {
  key: string
  kind: "file" | "directory"
  change: DeltaKind
  /** Present for `added` and `changed`: what the source holds now. */
  currentSize?: number
  currentHash?: string
  /** Whether this migration created the destination object for this key. */
  destinationOwned: boolean
}

/** One baseline row, as the delta needs it. */
export interface BaselineEntry {
  key: string
  kind: "file" | "directory"
  sourceSize: number | null
  sourceHash: string | null
  createdByMigration: boolean
  classification: string
}

export interface DeltaResult {
  entries: DeltaEntry[]
  added: number
  removed: number
  changed: number
  unchanged: number
  /** True when the delta hit its cap and stopped early. */
  truncated: boolean
}

/**
 * Whether a source entry still matches its baseline.
 *
 * SIZE IS A PRE-FILTER, NEVER THE PROOF. A different size proves difference
 * without reading anything, which is worth having on a large store. The same
 * size proves nothing at all — two different images are very often the same
 * length — so it falls through to a hash.
 *
 * `lastModified` is not consulted even as a hint here. It would be a plausible
 * one, but clocks skew and object stores set their own timestamps, so an
 * unchanged timestamp on a changed object is a real possibility and this is the
 * pass where being wrong means shipping a stale file as verified.
 */
async function fileChanged(
  source: StorageDriver,
  entry: StorageEntry,
  baseline: BaselineEntry,
): Promise<{ changed: boolean; hash?: string }> {
  if (baseline.sourceSize !== null && entry.size !== baseline.sourceSize) {
    return { changed: true }
  }

  if (!baseline.sourceHash) {
    // Nothing to compare against. Treated as changed so the reconciliation
    // re-copies and re-verifies rather than assuming.
    return { changed: true }
  }

  const digest = await digestObject(source, entry.key)
  return { changed: digest.hash !== baseline.sourceHash, hash: digest.hash }
}

/**
 * Compares the live source against the persisted baseline.
 *
 * Streams the source rather than listing it into memory, and stops at
 * `maxEntries`. The cap is not a performance guard — it is an availability one:
 * every storage mutation in the application is refused while this runs, so a
 * delta large enough to take minutes is a signal that the baseline is too stale
 * to finish from. Better to abort back to the source and run another baseline
 * pass than to hold uploads down indefinitely.
 */
export async function computeFinalDelta(
  source: StorageDriver,
  baseline: readonly BaselineEntry[],
  options: { maxEntries?: number } = {},
): Promise<DeltaResult> {
  const maxEntries = options.maxEntries ?? Number.POSITIVE_INFINITY
  const byKey = new Map(baseline.map((entry) => [entry.key, entry]))
  const seen = new Set<string>()
  const entries: DeltaEntry[] = []
  let truncated = false

  for await (const current of source.scanEntries()) {
    seen.add(current.key)
    const base = byKey.get(current.key)

    if (!base) {
      entries.push({
        key: current.key,
        kind: current.kind,
        change: "added",
        currentSize: current.size,
        destinationOwned: false,
      })
    } else if (current.kind === "directory") {
      // A directory has no content to diff; its existence on both sides is the
      // whole comparison.
      entries.push({
        key: current.key,
        kind: "directory",
        change: "unchanged",
        destinationOwned: base.createdByMigration,
      })
    } else {
      const verdict = await fileChanged(source, current, base)
      entries.push({
        key: current.key,
        kind: "file",
        change: verdict.changed ? "changed" : "unchanged",
        currentSize: current.size,
        currentHash: verdict.hash,
        destinationOwned: base.createdByMigration,
      })
    }

    if (entries.filter((e) => e.change !== "unchanged").length > maxEntries) {
      truncated = true
      break
    }
  }

  // Anything in the baseline the scan did not reach was deleted from the source.
  if (!truncated) {
    for (const base of baseline) {
      if (seen.has(base.key)) continue
      entries.push({
        key: base.key,
        kind: base.kind,
        change: "removed",
        // THE FLAG THAT DECIDES WHETHER ANYTHING MAY BE DELETED. Only an object
        // this migration created may be removed as stale; one that was at the
        // destination beforehand is somebody else's and stays.
        destinationOwned: base.createdByMigration,
      })
    }
  }

  const count = (change: DeltaKind) => entries.filter((entry) => entry.change === change).length

  return {
    entries,
    added: count("added"),
    removed: count("removed"),
    changed: count("changed"),
    unchanged: count("unchanged"),
    truncated,
  }
}

/**
 * What a delta means for a verify-only migration.
 *
 * ANY difference blocks, and nothing is repaired. The operator said they had
 * already migrated the files; a delta means that is no longer true, and the
 * honest answer is to tell them what moved and let them re-sync. Copying the
 * difference here would quietly convert a verification into a migration they
 * did not ask for — and would hide that their own process was incomplete.
 */
export function verifyOnlyBlockers(delta: DeltaResult): string[] {
  const reasons: string[] = []

  if (delta.added > 0) {
    reasons.push(
      `${delta.added} file(s) were added at the source after you verified. They are not at the ` +
        `destination, and FlowCMS has not copied them.`,
    )
  }
  if (delta.changed > 0) {
    reasons.push(
      `${delta.changed} file(s) changed at the source after you verified. The destination now ` +
        `holds an older version.`,
    )
  }
  if (delta.removed > 0) {
    reasons.push(
      `${delta.removed} file(s) were deleted at the source after you verified. Their copies are ` +
        `still at the destination and have been left alone.`,
    )
  }

  return reasons
}

/**
 * The work a copy-mode delta implies.
 *
 * Deliberately a PLAN rather than an execution: the caller applies it, so what
 * would happen can be inspected — and tested — separately from it happening.
 */
export interface ReconciliationPlan {
  /** Copy or re-copy these, then verify. */
  copy: DeltaEntry[]
  /** Remove these stale destination objects. All are migration-owned. */
  remove: DeltaEntry[]
  /** Source objects that vanished but whose destination copy is NOT ours. */
  retainAsExtra: DeltaEntry[]
  /** Reasons the cutover must not proceed at all. */
  blockers: string[]
}

export function planReconciliation(delta: DeltaResult, mode: MigrationMode): ReconciliationPlan {
  if (mode === "verify") {
    return { copy: [], remove: [], retainAsExtra: [], blockers: verifyOnlyBlockers(delta) }
  }

  const copy = delta.entries.filter((e) => e.change === "added" || e.change === "changed")
  const removed = delta.entries.filter((e) => e.change === "removed")

  return {
    copy,
    // ONLY WHAT THIS MIGRATION CREATED. A destination object that predates the
    // migration and happens to share a key with a since-deleted source object
    // is not stale — it is somebody else's file, and deleting it would destroy
    // data the migration never owned.
    remove: removed.filter((e) => e.destinationOwned),
    retainAsExtra: removed.filter((e) => !e.destinationOwned),
    blockers: delta.truncated
      ? [
          "Too much changed at the source while the migration was running. Storage has been " +
            "unlocked and nothing was switched; run the migration again to pick up the changes.",
        ]
      : [],
  }
}

/**
 * The last check before the switch: does the destination represent the source
 * as it stands right now?
 *
 * Every file is compared by exact key, kind and SHA-256 — not size, not a
 * timestamp, not an ETag. This is the assertion the whole migration is
 * ultimately making, and it is made against the destination's real bytes.
 */
export async function verifyDestinationMatches(
  source: StorageDriver,
  destination: StorageDriver,
  entries: readonly BaselineEntry[],
): Promise<{ ok: boolean; failures: { key: string; reason: string }[] }> {
  const failures: { key: string; reason: string }[] = []

  for (const entry of entries) {
    if (entry.classification === "destination_only") continue

    if (entry.kind === "directory") {
      const listing = await destination.listDirectory(
        entry.key.replace(/[^/]+\/$/, ""),
      )
      if (!listing.directories.includes(entry.key)) {
        failures.push({ key: entry.key, reason: "the folder is missing at the destination" })
      }
      continue
    }

    let sourceDigest
    try {
      sourceDigest = await digestObject(source, entry.key)
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) continue // handled as removed
      failures.push({ key: entry.key, reason: "the source could not be read" })
      continue
    }

    try {
      const destinationDigest = await digestObject(destination, entry.key)
      if (destinationDigest.hash !== sourceDigest.hash) {
        failures.push({ key: entry.key, reason: "the destination holds different content" })
      }
    } catch (error) {
      failures.push({
        key: entry.key,
        reason:
          error instanceof StorageObjectNotFoundError
            ? "it is missing at the destination"
            : "the destination could not be read",
      })
    }
  }

  return { ok: failures.length === 0, failures }
}
