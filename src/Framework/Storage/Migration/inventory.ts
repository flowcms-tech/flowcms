import {
  classifyDestinationOnly,
  classifySourceEntry,
} from "./classification"
import {
  createCompatibilityScanner,
  type KnownCaseSensitivity,
} from "./compatibility"
import type { MigrationRepository, MigrationRow } from "./migrationRepository"
import type { StorageDriver, StorageEntry } from "../StorageDriver"

/**
 * ENUMERATING BOTH SIDES, IN BOUNDED BATCHES, RESUMABLY.
 *
 * Phase 4a built the pieces that decide what one entry IS — compatibility,
 * classification, hashing. None of them enumerate, and nothing drove them. This
 * is the pass that walks both stores and writes down what it found, and its
 * whole design is about surviving being interrupted:
 *
 *   DESTINATION FIRST, THEN SOURCE. Classifying a source key needs to know
 *   whether the destination already holds it, and the only durable place to
 *   keep "what the destination holds" is the entry table. So the destination is
 *   enumerated into rows first, and the source pass reads them back one indexed
 *   lookup at a time — rather than holding a set of half a million keys in a
 *   process that may be restarted between batches.
 *
 *   EVERY BATCH ENDS AT A CURSOR. Both backends enumerate in ascending key
 *   order, so the last key processed is a complete resume token. Nothing about
 *   this pass lives in memory between calls.
 *
 *   NOTHING IS EXECUTED HERE. Inventory records a classification and leaves
 *   every entry `pending`. What to DO about a classification is the engine's
 *   single decision, made in `migrationEngine.ts`, and duplicating any part of
 *   it here would be two answers to one question.
 */

/** How many entries one call will enumerate. Bounded on purpose. */
export const DEFAULT_INVENTORY_BATCH = 200

export interface InventoryDeps {
  repository: MigrationRepository
  source: StorageDriver
  destination: StorageDriver
  /**
   * How the destination distinguishes keys.
   *
   * `null` for an S3 destination, where keys are case-sensitive byte strings
   * and no two distinct keys can collide. Required for a Local destination,
   * and typed to exclude `unknown` so a caller that has not resolved an
   * indeterminate probe cannot start an inventory at all.
   */
  destinationCaseSensitivity: KnownCaseSensitivity | null
}

export type InventoryPhase = "destination" | "source" | "complete"

export interface InventoryBatchResult {
  phase: InventoryPhase
  /** Entries enumerated by this call. */
  scanned: number
  /** Where this call stopped, or null when the phase finished. */
  cursor: string | null
  /** True when both scans have finished and the job may leave `inventorying`. */
  complete: boolean
}

/**
 * How the DESTINATION would tell this key apart from another.
 *
 * The value a collision check compares on, and the reason it differs per
 * destination:
 *
 *   S3          keys are opaque byte strings. `Photo.png`, `photo.png` and
 *               `photo.png/` are three different objects and all three can
 *               coexist, so the key IS its own identity and nothing is folded.
 *
 *   filesystem  a path. `foo/` and `foo` cannot both exist — one is a
 *               directory and the other a file — so the trailing slash is
 *               dropped. And on a case-insensitive volume `Photo.png` and
 *               `photo.png` are ONE file, so the key is folded to lower case.
 *
 * Folding on S3 would invent collisions that do not exist; not folding on a
 * case-insensitive filesystem would miss the one that silently destroys a file.
 */
export function normalizeKeyForDestination(
  key: string,
  destination: { driver: "s3" | "local"; caseSensitivity: KnownCaseSensitivity | null },
): string {
  if (destination.driver === "s3") return key

  const withoutSlash = key.replace(/\/+$/, "")
  return destination.caseSensitivity === "insensitive" ? withoutSlash.toLowerCase() : withoutSlash
}

/** Reads at most `limit` entries from a scan, and says whether more remain. */
async function takeBatch(
  driver: StorageDriver,
  after: string | null,
  limit: number,
): Promise<{ entries: StorageEntry[]; exhausted: boolean }> {
  const entries: StorageEntry[] = []
  let exhausted = true

  for await (const entry of driver.scanEntries(after ? { after } : undefined)) {
    if (entries.length >= limit) {
      // One more existed, so the scan is not finished. The iterator is
      // abandoned here; both drivers clean up on early return.
      exhausted = false
      break
    }
    entries.push(entry)
  }

  return { entries, exhausted }
}

/**
 * Advances the inventory by one bounded batch.
 *
 * Returns after that batch rather than looping to completion, for the same
 * reason `advanceMigration` does: a function that enumerated a whole store
 * would be one request that cannot survive a timeout, and a browser tab closed
 * mid-scan would lose everything it had found.
 */
export async function advanceInventory(
  job: MigrationRow,
  deps: InventoryDeps,
  options: { batchSize?: number } = {},
): Promise<InventoryBatchResult> {
  const { repository, source, destination, destinationCaseSensitivity } = deps
  const batchSize = options.batchSize ?? DEFAULT_INVENTORY_BATCH
  const destinationShape = {
    driver: job.destinationDriver as "s3" | "local",
    caseSensitivity: destinationCaseSensitivity,
  }
  const normalize = (key: string) => normalizeKeyForDestination(key, destinationShape)

  // ---- Phase one: what the destination already holds ----------------------
  if (!job.destinationScanCompletedAt) {
    const { entries, exhausted } = await takeBatch(destination, job.destinationCursor, batchSize)

    for (const entry of entries) {
      const classified = classifyDestinationOnly(entry)
      await repository.recordEntry(job.id, {
        key: entry.key,
        normalizedKey: normalize(entry.key),
        kind: entry.kind,
        classification: classified.classification,
        state: "pending",
        destinationSize: entry.size,
        detail: classified.detail ?? null,
      })
    }

    const cursor = entries.length > 0 ? entries[entries.length - 1].key : job.destinationCursor
    await repository.saveProgress(job.id, job.version, {
      destinationCursor: cursor,
      destinationScanCompletedAt: exhausted ? new Date() : null,
    } as Partial<MigrationRow>)

    return {
      phase: "destination",
      scanned: entries.length,
      cursor: exhausted ? null : cursor,
      complete: false,
    }
  }

  // ---- Phase two: the source, classified against those rows ---------------
  if (!job.sourceScanCompletedAt) {
    const { entries, exhausted } = await takeBatch(source, job.sourceCursor, batchSize)

    // A fresh scanner per batch. Its stateless per-key checks — unsafe path,
    // reserved device name, trailing dot or space — are the ones that matter
    // here; the SET-shaped check it also does is superseded by the durable
    // `normalizedKey` lookup below, which stays correct across batches where an
    // in-memory set cannot.
    const scanner =
      destinationShape.driver === "local" && destinationCaseSensitivity
        ? createCompatibilityScanner({ caseSensitivity: destinationCaseSensitivity })
        : null

    for (const entry of entries) {
      await recordSourceEntry(entry, {
        job,
        repository,
        source,
        destination,
        scanner,
        normalize,
      })
    }

    const cursor = entries.length > 0 ? entries[entries.length - 1].key : job.sourceCursor
    await repository.saveProgress(job.id, job.version, {
      sourceCursor: cursor,
      sourceScanCompletedAt: exhausted ? new Date() : null,
    } as Partial<MigrationRow>)

    if (exhausted) {
      // ANYTHING THIS PASS DID NOT TOUCH IS LEFT OVER FROM AN EARLIER ONE.
      // Inventory is re-runnable, and without this a key deleted from the
      // source between two passes would keep its row, stay unprocessed, and
      // block readiness forever.
      await repository.resolveUnseenEntries(job.id, job.inventoryStartedAt ?? new Date(0))
    }

    return {
      phase: "source",
      scanned: entries.length,
      cursor: exhausted ? null : cursor,
      complete: exhausted,
    }
  }

  return { phase: "complete", scanned: 0, cursor: null, complete: true }
}

/**
 * Records one source entry, with the two checks that must happen before it is
 * classified at all.
 */
async function recordSourceEntry(
  entry: StorageEntry,
  context: {
    job: MigrationRow
    repository: MigrationRepository
    source: StorageDriver
    destination: StorageDriver
    scanner: ReturnType<typeof createCompatibilityScanner> | null
    normalize: (key: string) => string
  },
): Promise<void> {
  const { job, repository, source, destination, scanner, normalize } = context
  const normalizedKey = normalize(entry.key)

  // 1. CAN THE DESTINATION REPRESENT THIS KEY AT ALL? Asked first and
  //    short-circuiting: an entry the destination cannot hold must not then be
  //    read and hashed, and the resulting "missing" would be misleading — it is
  //    not missing, it is impossible.
  const issue = scanner?.inspect({ key: entry.key, kind: entry.kind }) ?? null
  if (issue) {
    await repository.recordEntry(job.id, {
      key: entry.key,
      normalizedKey,
      kind: entry.kind,
      classification: "incompatible",
      state: "pending",
      sourceSize: entry.size,
      sourceLastModified: entry.lastModified ?? null,
      detail: issue.detail,
    })
    return
  }

  // 2. DOES ANOTHER KEY ALREADY CLAIM THE SAME DESTINATION PATH?
  //
  //    The check an in-memory scanner cannot make across batches. Both keys are
  //    marked, not just the second: an operator told "these two collide" can
  //    act, and one told "this one collides with something" cannot.
  const collidingRows =
    job.destinationDriver === "local"
      ? await repository.findByNormalizedKey(job.id, normalizedKey, entry.key)
      : []
  const collision = collidingRows.find((row) => row.classification !== "destination_only")

  if (collision) {
    const detail =
      `This key and "${collision.key}" would become the same file at the destination. ` +
      `FlowCMS will not rename either of them: the keys are referenced by published content, ` +
      `and rewriting one would break every link to it.`

    await repository.recordEntry(job.id, {
      key: entry.key,
      normalizedKey,
      kind: entry.kind,
      classification: "incompatible",
      state: "pending",
      sourceSize: entry.size,
      sourceLastModified: entry.lastModified ?? null,
      detail,
    })
    await repository.markEntry(job.id, collision.key, {
      classification: "incompatible",
      detail:
        `This key and "${entry.key}" would become the same file at the destination.`,
    })
    return
  }

  // 3. WHAT IS THE DIFFERENCE BETWEEN THE TWO SIDES?
  //
  //    "The destination has this key" is read from the row the destination scan
  //    wrote, and only when that row was written by THIS pass — a row left over
  //    from an earlier inventory says nothing about what is there now.
  const existing = await repository.findEntry(job.id, entry.key)
  const seenAtDestination =
    existing !== null &&
    existing.classification === "destination_only" &&
    (!job.inventoryStartedAt || existing.updatedAt >= job.inventoryStartedAt)

  const classified = await classifySourceEntry(entry, {
    source,
    destination,
    destinationKeys: new Set(seenAtDestination ? [entry.key] : []),
  })

  await repository.recordEntry(job.id, {
    key: entry.key,
    normalizedKey,
    kind: entry.kind,
    classification: classified.classification,
    // ALWAYS `pending`. What a classification means for the work is the
    // engine's single decision; deciding any part of it here would be a second
    // answer to the same question, and the two would drift.
    state: "pending",
    sourceSize: classified.sourceSize ?? entry.size,
    sourceLastModified: entry.lastModified ?? null,
    sourceHash: classified.sourceHash ?? null,
    destinationSize: classified.destinationSize ?? null,
    destinationHash: classified.destinationHash ?? null,
    detail: classified.detail ?? null,
  })
}
