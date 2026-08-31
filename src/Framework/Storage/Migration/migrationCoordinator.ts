import { randomUUID } from "node:crypto"
import { digestObject } from "./contentHash"
import { executeBatch, type EntryOutcome, type ExecutableEntry } from "./migrationEngine"
import { StorageObjectNotFoundError } from "../StorageErrors"
import type { MigrationMode } from "./migrationState"
import type { MigrationRepository } from "./migrationRepository"
import type { StorageDriver } from "../StorageDriver"

/**
 * THE DRIVING LOOP.
 *
 * Phase 4b1's engine decides what to do with one entry and returns an outcome;
 * it deliberately touches no database, which is what makes it retryable and
 * testable. This is the half that makes progress DURABLE: claim work, run it,
 * write down what happened, and be resumable from nothing but the database.
 *
 * NOTHING HERE IS THE SOURCE OF TRUTH IN MEMORY. A restart mid-migration reads
 * its entire position out of `storage_migration` and `storage_migration_entry`.
 * There is no in-flight promise whose loss would strand a job, and no counter
 * held in a variable that a crash would lose.
 *
 * IT STILL CANNOT CUT OVER. Advancing a job is claiming, copying, verifying and
 * counting. Making the destination authoritative is `cutover.ts`, a separate
 * module with a separate entry point and its own gate.
 */

/** How many entries one call will take on. Bounded on purpose. */
const DEFAULT_BATCH = 50

/** How long a claim is honoured before another run may take it over. */
const DEFAULT_LEASE_MS = 15 * 60 * 1000

export interface CoordinatorDeps {
  repository: MigrationRepository
  source: StorageDriver
  destination: StorageDriver
  mode: MigrationMode
  /** Identifies this process/run, so a lease can tell "mine" from "somebody's". */
  runId?: string
}

export interface BatchResult {
  claimed: number
  outcomes: EntryOutcome[]
  /** No entry was claimable — every one is finished or held by a live lease. */
  exhausted: boolean
}

/**
 * Recovers an entry whose recorded state cannot be trusted.
 *
 * `copying` and `copied` both mean "a write happened or may have happened, and
 * nothing proved the result". Phase 4b1 named the states; this decides what to
 * do with one on resume, and the rule that matters is:
 *
 *   NEVER BLINDLY RE-UPLOAD, AND NEVER BLINDLY OVERWRITE.
 *
 * Re-uploading is wasteful when the object is already correct, and overwriting
 * is destructive when the object is not ours. So the destination is INSPECTED
 * first:
 *
 *   matches the baseline hash          -> it is done; mark verified
 *   differs, and we created it         -> ours, incomplete; safe to replace
 *   differs, and we did NOT create it  -> somebody else's file. Block.
 *   absent                             -> nothing was written; copy normally
 *
 * The third case is the one that protects data. A database failure after a
 * successful write could leave ownership unrecorded, and treating "I do not
 * know who wrote this" as "I did" is how a migration overwrites a file it never
 * owned.
 */
export async function recoverAmbiguousEntry(
  entry: ExecutableEntry,
  destination: StorageDriver,
): Promise<EntryOutcome | null> {
  let digest
  try {
    digest = await digestObject(destination, entry.key)
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) {
      // Nothing landed. Ordinary copy work; the engine handles it.
      return null
    }
    return {
      key: entry.key,
      state: "failed",
      createdByMigration: entry.createdByMigration,
      detail: "the destination could not be inspected",
    }
  }

  if (entry.sourceHash && digest.hash === entry.sourceHash) {
    // The write did complete; only the bookkeeping was lost.
    return {
      key: entry.key,
      state: "verified",
      createdByMigration: entry.createdByMigration,
      destinationSize: digest.size,
      destinationHash: digest.hash,
    }
  }

  if (entry.createdByMigration) {
    // Ours and wrong — a truncated or interrupted write. Returning null sends
    // it back through the engine, which replaces it.
    return null
  }

  // Present, different, and not provably ours. This is the case where guessing
  // costs somebody their file.
  return {
    key: entry.key,
    state: "blocked",
    createdByMigration: false,
    detail:
      "The destination holds a different file under this key and FlowCMS cannot prove it wrote " +
      "it, so it will not be overwritten.",
  }
}

/**
 * Runs one bounded batch and persists every outcome.
 *
 * Returns what happened rather than looping to completion, so the caller — a
 * Phase 4c poll, a script, a test — decides how much work to do at once. A
 * function that ran the whole migration would be a single request that cannot
 * survive a timeout, which is the thing this design exists to avoid.
 */
export async function advanceMigration(
  migrationId: string,
  deps: CoordinatorDeps,
  options: { batchSize?: number; concurrency?: number; leaseMs?: number } = {},
): Promise<BatchResult> {
  const { repository, source, destination, mode } = deps
  const runId = deps.runId ?? randomUUID()
  const batchSize = options.batchSize ?? DEFAULT_BATCH

  const claimed = await repository.claimEntries(migrationId, runId, batchSize, {
    leaseMs: options.leaseMs ?? DEFAULT_LEASE_MS,
  })

  if (claimed.length === 0) return { claimed: 0, outcomes: [], exhausted: true }

  const executable: ExecutableEntry[] = claimed.map((row) => ({
    key: row.key,
    kind: row.kind as "file" | "directory",
    classification: row.classification,
    state: row.state as ExecutableEntry["state"],
    sourceSize: row.sourceSize,
    sourceHash: row.sourceHash,
    createdByMigration: row.createdByMigration,
  }))

  // Entries whose recorded state is ambiguous are resolved by INSPECTING the
  // destination before any of them is re-executed.
  const outcomes: EntryOutcome[] = []
  const needsExecution: ExecutableEntry[] = []

  for (const entry of executable) {
    if (entry.state === "copying" || entry.state === "copied") {
      const recovered = await recoverAmbiguousEntry(entry, destination)
      if (recovered) {
        outcomes.push(recovered)
        continue
      }
    }
    needsExecution.push(entry)
  }

  if (needsExecution.length > 0) {
    outcomes.push(
      ...(await executeBatch(needsExecution, {
        mode,
        source,
        destination,
        concurrency: options.concurrency,
      })),
    )
  }

  // PERSISTED ONE BY ONE, not in a single transaction over the batch. A batch
  // transaction would discard forty successful copies because the forty-first
  // failed, and those copies really happened — the destination has the bytes.
  // Per-entry writes mean progress survives whatever went wrong.
  for (const outcome of outcomes) {
    await repository.saveOutcome(migrationId, outcome.key, {
      state: outcome.state,
      createdByMigration: outcome.createdByMigration,
      destinationSize: outcome.destinationSize ?? null,
      destinationHash: outcome.destinationHash ?? null,
      detail: outcome.detail ?? null,
      incrementAttempts: outcome.state === "failed",
    })
  }

  return { claimed: claimed.length, outcomes, exhausted: false }
}

/** Counters derived from the entry rows, so a retry cannot double-count. */
export interface MigrationProgress {
  total: number
  verified: number
  pending: number
  failed: number
  blocked: number
  sourceChanged: number
  sourceDeleted: number
  ambiguous: number
}

/**
 * Progress, DERIVED rather than accumulated.
 *
 * Incrementing a counter per completed entry is how a retry counts the same
 * object twice, and how a crash between the object write and the counter write
 * loses one forever. Counting rows costs one grouped query and cannot drift
 * from the thing it describes.
 */
export async function readProgress(
  migrationId: string,
  repository: MigrationRepository,
): Promise<MigrationProgress> {
  const byState = await repository.countByState(migrationId)
  const get = (state: string) => byState[state] ?? 0

  return {
    total: Object.values(byState).reduce((n, v) => n + v, 0),
    verified: get("verified"),
    pending: get("pending"),
    failed: get("failed"),
    blocked: get("blocked"),
    sourceChanged: get("source_changed"),
    sourceDeleted: get("source_deleted"),
    ambiguous: get("copying") + get("copied"),
  }
}

export interface ReadinessVerdict {
  ready: boolean
  /** Why not, in terms an operator can act on. */
  reasons: string[]
}

/**
 * May this migration proceed to a cutover?
 *
 * "THE BATCHES FINISHED" IS NOT THE SAME QUESTION, and conflating the two is
 * the mistake this function exists to prevent. A run can process every claimable
 * entry and leave behind blocked conflicts, entries whose source changed
 * underneath it, and objects written but never proven — all of which look like
 * "no work left to claim".
 *
 * Every condition below is a reason a cutover would produce a destination that
 * does not faithfully represent the source.
 */
export async function assessReadiness(
  migrationId: string,
  repository: MigrationRepository,
  mode: MigrationMode,
): Promise<ReadinessVerdict> {
  const byState = await repository.countByState(migrationId)
  const byClassification = await repository.countByClassification(migrationId)
  const get = (map: Record<string, number>, key: string) => map[key] ?? 0

  const reasons: string[] = []

  if (get(byClassification, "incompatible") > 0) {
    reasons.push(
      `${get(byClassification, "incompatible")} key(s) cannot be represented at the destination.`,
    )
  }
  if (get(byClassification, "conflicting") > 0) {
    reasons.push(
      `${get(byClassification, "conflicting")} file(s) already exist at the destination with different content.`,
    )
  }
  if (get(byState, "blocked") > 0) {
    reasons.push(`${get(byState, "blocked")} entr(ies) need a decision before this can continue.`)
  }
  if (get(byState, "failed") > 0) {
    reasons.push(`${get(byState, "failed")} entr(ies) failed and have not succeeded on retry.`)
  }
  if (get(byState, "pending") > 0) {
    reasons.push(`${get(byState, "pending")} entr(ies) have not been processed yet.`)
  }
  // AMBIGUOUS STATES BLOCK. An object written but never read back is not
  // evidence of anything, and cutting over on it would make an unverified file
  // the live one.
  if (get(byState, "copying") + get(byState, "copied") > 0) {
    reasons.push(
      `${get(byState, "copying") + get(byState, "copied")} entr(ies) were written but not verified.`,
    )
  }
  // Recorded distinctly rather than counted as verified: the baseline no longer
  // describes them, so only the final delta can resolve them.
  if (get(byState, "source_changed") > 0) {
    reasons.push(
      `${get(byState, "source_changed")} file(s) changed at the source and need re-checking.`,
    )
  }
  if (get(byState, "source_deleted") > 0) {
    reasons.push(
      `${get(byState, "source_deleted")} file(s) were deleted at the source and need reconciling.`,
    )
  }

  // In verify-only mode the operator claimed everything was already there, so
  // anything that was not already matching is a failure of that claim.
  if (mode === "verify" && get(byClassification, "missing") > 0) {
    reasons.push(
      `${get(byClassification, "missing")} file(s) are not at the destination, but this migration ` +
        `was started as "already migrated".`,
    )
  }

  return { ready: reasons.length === 0, reasons }
}
