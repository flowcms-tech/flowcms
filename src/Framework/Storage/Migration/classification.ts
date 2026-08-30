import { compareObjects } from "./contentHash"
import { classificationBlocks, type EntryClassification, type MigrationMode } from "./migrationState"
import type { StorageDriver, StorageEntry } from "../StorageDriver"

/**
 * WHAT THE SOURCE AND DESTINATION ACTUALLY DIFFER BY.
 *
 * Runs after both sides have been enumerated and before anything is copied.
 * Nothing here writes: classification is a statement about the world, and a
 * function that both decided and acted would make "what would happen" and "what
 * happened" the same call.
 *
 * MATCHING MEANS IDENTICAL BYTES. Not the same size, not the same ETag. Two
 * different images are very often the same number of bytes, and a multipart
 * ETag depends on the part size whoever uploaded it chose — so both shortcuts
 * can call two different objects the same, and a file that was never copied
 * would be reported as migrated.
 */

export interface ClassifiedEntry {
  key: string
  kind: "file" | "directory"
  classification: EntryClassification
  sourceSize?: number
  sourceHash?: string
  destinationSize?: number
  destinationHash?: string
  /** Operator-facing explanation, for anything that blocks. */
  detail?: string
}

/**
 * Directory entries are compared LOGICALLY, not by content.
 *
 * An empty folder is a zero-byte marker object on S3 and a real directory on a
 * filesystem. They are not the same bytes and they are not supposed to be —
 * they are the same FACT, expressed the way each backend expresses it. Hashing
 * them would report every empty folder as a conflict.
 */
function classifyDirectory(existsAtDestination: boolean): EntryClassification {
  return existsAtDestination ? "matching" : "missing"
}

export interface ClassifyOptions {
  source: StorageDriver
  destination: StorageDriver
  /** Keys the destination already holds, from the destination scan. */
  destinationKeys: ReadonlySet<string>
  /** Already-known incompatible keys, from the compatibility scan. */
  incompatible?: ReadonlyMap<string, string>
}

/**
 * Classifies ONE source entry.
 *
 * Compatibility is checked first and short-circuits: an entry the destination
 * cannot represent must not then be read and hashed, both because the work is
 * wasted and because the resulting "missing" would be misleading — it is not
 * missing, it is impossible.
 */
export async function classifySourceEntry(
  entry: StorageEntry,
  options: ClassifyOptions,
): Promise<ClassifiedEntry> {
  const incompatibleDetail = options.incompatible?.get(entry.key)
  if (incompatibleDetail !== undefined) {
    return {
      key: entry.key,
      kind: entry.kind,
      classification: "incompatible",
      detail: incompatibleDetail,
    }
  }

  if (entry.kind === "directory") {
    return {
      key: entry.key,
      kind: "directory",
      classification: classifyDirectory(options.destinationKeys.has(entry.key)),
    }
  }

  // A file the destination does not have at all: no need to read either side.
  if (!options.destinationKeys.has(entry.key)) {
    return { key: entry.key, kind: "file", classification: "missing", sourceSize: entry.size }
  }

  const comparison = await compareObjects(
    { driver: options.source, key: entry.key },
    { driver: options.destination, key: entry.key },
  )

  switch (comparison.result) {
    case "identical":
      return {
        key: entry.key,
        kind: "file",
        classification: "matching",
        sourceSize: comparison.size,
        sourceHash: comparison.hash,
        destinationSize: comparison.size,
        destinationHash: comparison.hash,
      }

    case "different":
      return {
        key: entry.key,
        kind: "file",
        classification: "conflicting",
        sourceSize: comparison.sourceSize,
        sourceHash: comparison.sourceHash,
        destinationSize: comparison.destinationSize,
        destinationHash: comparison.destinationHash,
        detail:
          comparison.sourceSize === comparison.destinationSize
            ? // Called out explicitly because it is the case that looks like a
              // match to every cheap check.
              "A different file with the same name and the same size is already at the destination."
            : "A different file with the same name is already at the destination.",
      }

    case "destination_missing":
      // The destination listing said it was there and the read said otherwise —
      // it was removed between the two. Treated as missing, which is the state
      // it is actually in.
      return {
        key: entry.key,
        kind: "file",
        classification: "missing",
        sourceSize: comparison.sourceSize,
        sourceHash: comparison.sourceHash,
      }

    case "source_missing":
      // The source object went away mid-analysis. Not an error: the store is
      // live. Recorded as matching-by-absence would be wrong, so it is left as
      // missing for the delta pass to resolve against a fresh read.
      return { key: entry.key, kind: "file", classification: "missing" }
  }
}

/** A destination entry the source does not have. Reported, never deleted. */
export function classifyDestinationOnly(entry: StorageEntry): ClassifiedEntry {
  return {
    key: entry.key,
    kind: entry.kind,
    classification: "destination_only",
    destinationSize: entry.size,
    detail:
      "This is already at the destination and is not at the source. It will not be touched, and " +
      "it will become visible in the File Manager after the switch.",
  }
}

/** Counters, as the job row stores them. */
export interface ClassificationTotals {
  missing: number
  matching: number
  conflicting: number
  destinationOnly: number
  incompatible: number
}

export function emptyTotals(): ClassificationTotals {
  return { missing: 0, matching: 0, conflicting: 0, destinationOnly: 0, incompatible: 0 }
}

export function addToTotals(
  totals: ClassificationTotals,
  classification: EntryClassification,
): ClassificationTotals {
  switch (classification) {
    case "missing":
      return { ...totals, missing: totals.missing + 1 }
    case "matching":
      return { ...totals, matching: totals.matching + 1 }
    case "conflicting":
      return { ...totals, conflicting: totals.conflicting + 1 }
    case "destination_only":
      return { ...totals, destinationOnly: totals.destinationOnly + 1 }
    case "incompatible":
      return { ...totals, incompatible: totals.incompatible + 1 }
  }
}

/**
 * Whether these totals allow a job to reach `ready`, given its mode.
 *
 * The mode changes exactly one thing — what a MISSING file means — and it is
 * the operator's own claim that changes it. In copy mode a missing file is the
 * work. In verify-only mode the operator said the files were already there, so
 * a missing one means their claim is false; copying it quietly would answer a
 * question they did not ask and hide that their own migration was incomplete.
 */
export function isReadyForMigration(
  totals: ClassificationTotals,
  mode: MigrationMode,
): { ready: boolean; blockedBy: EntryClassification[] } {
  const blockedBy = (
    ["incompatible", "conflicting", "missing", "matching", "destination_only"] as const
  ).filter((classification) => {
    if (!classificationBlocks(classification, mode)) return false
    switch (classification) {
      case "incompatible":
        return totals.incompatible > 0
      case "conflicting":
        return totals.conflicting > 0
      case "missing":
        return totals.missing > 0
      default:
        return false
    }
  })

  return { ready: blockedBy.length === 0, blockedBy: [...blockedBy] }
}
