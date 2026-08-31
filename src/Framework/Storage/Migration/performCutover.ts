import {
  CUTOVER_WINDOW_MS,
  MAX_FINAL_DELTA_ENTRIES,
  windowExpired,
  type CutoverRefusal,
} from "./cutover"
import {
  computeFinalDelta,
  planReconciliation,
  verifyDestinationMatches,
  type BaselineEntry,
  type DeltaEntry,
} from "./finalDelta"
import { executeBatch, type ExecutableEntry } from "./migrationEngine"
import { assessReadiness } from "./migrationCoordinator"
import type { MigrationMode } from "./migrationState"
import type { MigrationRepository, MigrationRow } from "./migrationRepository"
import type { ResolvedStorageConfig } from "../storageConfig"
import type { StorageDriver } from "../StorageDriver"

/**
 * THE WHOLE CRITICAL SECTION, IN ONE PLACE.
 *
 * Phase 4b2 built every step of a cutover and left them as separate exported
 * functions: acquire the lock, compute the final delta, plan the
 * reconciliation, verify, commit, invalidate, clear credentials. Each is
 * correct on its own and the ORDER between them is the safety property — run
 * the delta before the lock and it describes a source that can still change;
 * clear the credentials before the commit and a failure leaves an installation
 * that cannot reach either location.
 *
 * An order that lives in the caller is an order that gets re-derived, slightly
 * differently, by the next caller. So there is exactly one caller, and it is
 * this function. Routes and UI ask for a cutover; they do not assemble one.
 *
 *     validate job
 *       -> ensure ready_to_cutover
 *       -> acquire durable lock          storage mutations stop here
 *       -> final live-source delta       the source is frozen, so this is real
 *       -> reconcile, per mode           copy mode only ever
 *       -> restate the baseline rows     so a restart sees what happened
 *       -> final strong verification     SHA-256, against the destination
 *       -> ONE AUTHORITATIVE COMMIT      irreversible; everything after is
 *       -> invalidate caches                bookkeeping
 *       -> clear temporary credentials
 *       -> lock released with the terminal state
 *
 * THE INVARIANT, unchanged from 4b2 and enforced at every early exit below:
 *
 *   Until the transaction commits, the SOURCE is authoritative.
 *
 * WHAT AN ABORT DOES. Every failure before the commit releases the lock and
 * puts the job back to `ready_to_cutover` — resumable, not failed. Storage
 * unlocks, nothing switched, and the destination keeps the work this migration
 * has already done there, which the next attempt reuses. The one case that does
 * NOT release is an active topology that is no longer the source: the release
 * would be a guess about which of two states the installation is in, and
 * `assessRecovery` is the function whose whole job is to answer that from
 * durable facts.
 */

export interface CutoverDeps {
  repository: MigrationRepository
  /** The live source — the topology that is active right now. */
  source: StorageDriver
  destination: StorageDriver
  destinationConfig: ResolvedStorageConfig
  /** Moves the job into `cutting_over`, conditionally. Phase 4b2's primitive. */
  acquireLock: (migrationId: string, fromStatus: string) => Promise<boolean>
  /** The one authoritative transaction. Phase 4b2's `commitCutover`. */
  commit: (job: MigrationRow, destination: ResolvedStorageConfig) => Promise<void>
  clearCredentials: (migrationId: string) => Promise<void>
  /** Where the installation says its files are, right now. */
  activeLocationId: () => Promise<string | null>
}

export interface ReconciliationSummary {
  copied: number
  removed: number
  retainedAsExtra: number
  unchanged: number
}

export type CutoverResult =
  /** The destination is authoritative. */
  | { outcome: "completed"; migrationId: string; reconciliation: ReconciliationSummary }
  /** Refused before the lock was taken. Nothing happened at all. */
  | { outcome: "refused"; refusal: CutoverRefusal; reasons: string[] }
  /** Lock taken, something stopped it, lock released. Source still authoritative. */
  | { outcome: "aborted"; refusal: CutoverRefusal; reasons: string[] }
  /** Lock taken and could NOT be safely released. Recovery must decide. */
  | { outcome: "needs_recovery"; reasons: string[] }

export interface CutoverOptions {
  /** Overridable only so tests can force the limits. Production uses the constants. */
  maxDeltaEntries?: number
  windowMs?: number
  /** Bounded, like every other batch in this system. */
  concurrency?: number
}

/**
 * Runs a cutover from beginning to end, or explains why it did not.
 */
export async function performCutover(
  migrationId: string,
  deps: CutoverDeps,
  options: CutoverOptions = {},
): Promise<CutoverResult> {
  const { repository } = deps
  const maxDeltaEntries = options.maxDeltaEntries ?? MAX_FINAL_DELTA_ENTRIES
  const windowMs = options.windowMs ?? CUTOVER_WINDOW_MS

  // ---- 1. Validate, entirely before anything is locked --------------------
  const job = await repository.findById(migrationId)
  if (!job) {
    return { outcome: "refused", refusal: "not_ready", reasons: ["That migration no longer exists."] }
  }

  if (job.status !== "ready_to_cutover") {
    return {
      outcome: "refused",
      refusal: "not_ready",
      reasons: [
        `This migration is ${describeStatus(job.status)}. A cutover can only run once the ` +
          `destination has been fully verified.`,
      ],
    }
  }

  // THE SOURCE MUST STILL BE WHERE THE JOB THINKS IT IS. If it is not,
  // something outside this migration moved the installation and no part of what
  // follows would be describing reality.
  const activeBefore = await deps.activeLocationId()
  if (activeBefore !== job.sourceLocationId) {
    return {
      outcome: "refused",
      refusal: "already_committed_elsewhere",
      reasons: [
        "This installation's active storage is no longer the location this migration started " +
          "from, so the migration cannot be trusted to describe it. Nothing has been changed.",
      ],
    }
  }

  const extras = await repository.countEntriesMatching(job.id, {
    classification: "destination_only",
  })
  if (extras > 0 && (!job.extrasAcknowledged || job.extrasAcknowledgedCount !== extras)) {
    return {
      outcome: "refused",
      refusal: "not_ready",
      reasons: [
        `The destination holds ${extras} file(s) that are not at the source. They will not be ` +
          `deleted and will become visible in the File Manager after the switch — that has to be ` +
          `acknowledged before the cutover runs.`,
      ],
    }
  }

  const readiness = await assessReadiness(job.id, repository, job.mode as MigrationMode)
  if (!readiness.ready) {
    return { outcome: "refused", refusal: "not_ready", reasons: readiness.reasons }
  }

  // ---- 2. Take the lock. Storage mutations stop from this line -------------
  const locked = await deps.acquireLock(job.id, "ready_to_cutover")
  if (!locked) {
    return {
      outcome: "refused",
      refusal: "already_committed_elsewhere",
      reasons: [
        "Another cutover request took this migration first. Reload to see where it got to.",
      ],
    }
  }

  // Re-read: the lock primitive stamps `cutoverStartedAt`, and that stamp is
  // what bounds the window — for this call and for a restart that finds the
  // job still locked.
  const lockedJob = (await repository.findById(job.id)) ?? job
  const started = lockedJob.cutoverStartedAt ?? new Date()

  try {
    return await runCriticalSection(lockedJob, deps, {
      maxDeltaEntries,
      windowMs,
      started,
      concurrency: options.concurrency,
    })
  } catch (error) {
    // An unexpected failure inside the window. The commit either happened or it
    // did not, and only the durable topology can say which — so the release is
    // guarded exactly like every other abort below.
    return release(deps, job.id, "verification_failed", [
      "The cutover did not complete. Nothing was switched; the original storage is still active.",
      describeUnexpected(error),
    ])
  }
}

/** Everything that happens while storage is locked. */
async function runCriticalSection(
  job: MigrationRow,
  deps: CutoverDeps,
  context: { maxDeltaEntries: number; windowMs: number; started: Date; concurrency?: number },
): Promise<CutoverResult> {
  const { repository, source, destination } = deps
  const mode = job.mode as MigrationMode

  const rows = await repository.baselineEntries(job.id)

  // DESTINATION-ONLY ROWS ARE NOT PART OF THE DELTA. They were never at the
  // source, so "did the source change" does not apply to them — including them
  // would report every acknowledged extra as a file deleted from the source.
  const baseline: BaselineEntry[] = rows
    .filter((row) => row.classification !== "destination_only")
    .map((row) => ({
      key: row.key,
      kind: row.kind as "file" | "directory",
      sourceSize: row.sourceSize,
      sourceHash: row.sourceHash,
      createdByMigration: row.createdByMigration,
      classification: row.classification,
    }))

  // ---- 3. What moved while the baseline was being built -------------------
  const delta = await computeFinalDelta(source, baseline, {
    maxEntries: context.maxDeltaEntries,
  })

  const plan = planReconciliation(delta, mode)
  if (plan.blockers.length > 0) {
    // Includes the truncation blocker — the bound is enforced by ACTING on it,
    // not by having a constant.
    return release(deps, job.id, delta.truncated ? "delta_too_large" : "verification_failed", plan.blockers)
  }

  if (expired(context.started, context.windowMs)) {
    return release(deps, job.id, "window_exceeded", [windowMessage()])
  }

  // ---- 4. Reconcile, according to the mode --------------------------------
  const reconciliation = await applyReconciliation(job, plan.copy, plan.remove, deps, {
    concurrency: context.concurrency,
  })
  if (reconciliation.failures.length > 0) {
    return release(deps, job.id, "verification_failed", reconciliation.failures)
  }

  // ---- 5. Make the persisted model describe what actually happened --------
  await restateBaseline(job, delta, plan.retainAsExtra, deps)

  if (expired(context.started, context.windowMs)) {
    return release(deps, job.id, "window_exceeded", [windowMessage()])
  }

  // ---- 6. The last check before the switch --------------------------------
  const refreshed = await repository.baselineEntries(job.id)
  const verification = await verifyDestinationMatches(
    source,
    destination,
    refreshed.map((row) => ({
      key: row.key,
      kind: row.kind as "file" | "directory",
      sourceSize: row.sourceSize,
      sourceHash: row.sourceHash,
      createdByMigration: row.createdByMigration,
      classification: row.classification,
    })),
  )

  if (!verification.ok) {
    return release(
      deps,
      job.id,
      "verification_failed",
      [
        mode === "verify"
          ? `${verification.failures.length} file(s) at the destination do not match the source. ` +
            `Nothing was switched. Sync the destination and verify again.`
          : `${verification.failures.length} file(s) could not be verified at the destination. ` +
            `Nothing was switched.`,
        ...verification.failures.slice(0, 10).map((f) => `${f.key}: ${f.reason}`),
      ],
    )
  }

  // ---- 7. THE IRREVERSIBLE STEP -------------------------------------------
  const current = await repository.findById(job.id)
  if (!current || current.status !== "cutting_over") {
    return { outcome: "needs_recovery", reasons: ["This migration changed while the cutover was running."] }
  }

  await deps.commit(current, deps.destinationConfig)

  // ---- 8. Bookkeeping. A failure here does NOT revert anything ------------
  //
  // The destination is authoritative from the line above. Clearing the job's
  // duplicate copy of the credentials is a tidying step: it removes a second
  // place the secret sits at rest, now that the settings row holds it. If it
  // fails, recovery retries it — reverting storage over a failed cleanup would
  // trade a redundant secret for lost writes.
  await deps.clearCredentials(job.id).catch(() => {})

  return { outcome: "completed", migrationId: job.id, reconciliation: reconciliation.summary }
}

/**
 * Copies what changed and removes what this migration owns and no longer needs.
 *
 * VERIFY-ONLY MODE NEVER REACHES HERE WITH WORK. `planReconciliation` returns
 * empty `copy` and `remove` arrays for it structurally, so there is no code
 * path in which a verification quietly becomes a migration.
 */
async function applyReconciliation(
  job: MigrationRow,
  copy: DeltaEntry[],
  remove: DeltaEntry[],
  deps: CutoverDeps,
  options: { concurrency?: number },
): Promise<{ summary: ReconciliationSummary; failures: string[] }> {
  const { repository, source, destination } = deps
  const failures: string[] = []

  const executable: ExecutableEntry[] = copy.map((entry) => ({
    key: entry.key,
    kind: entry.kind,
    // Deliberately NOT the recorded classification: the delta has just read the
    // source, and this is a copy of what is there now.
    classification: "missing",
    state: "pending",
    sourceSize: entry.currentSize ?? null,
    sourceHash: null,
    createdByMigration: entry.destinationOwned,
  }))

  const outcomes =
    executable.length > 0
      ? await executeBatch(executable, {
          mode: "copy",
          source,
          destination,
          concurrency: options.concurrency,
        })
      : []

  for (const outcome of outcomes) {
    if (outcome.state !== "verified") {
      failures.push(`${outcome.key}: ${outcome.detail ?? "could not be reconciled"}`)
      continue
    }

    // Recorded before the row is guaranteed to exist: a file ADDED after the
    // baseline has no entry at all, and one that is not written down is one a
    // restart cannot account for.
    await repository.recordEntry(job.id, {
      key: outcome.key,
      kind: outcome.key.endsWith("/") ? "directory" : "file",
      classification: "missing",
      state: "verified",
      sourceSize: outcome.destinationSize ?? null,
      sourceHash: outcome.destinationHash ?? null,
    })
    await repository.saveOutcome(job.id, outcome.key, {
      state: "verified",
      createdByMigration: true,
      destinationSize: outcome.destinationSize ?? null,
      destinationHash: outcome.destinationHash ?? null,
      // THE BASELINE IS RESTATED. Leaving the old hash would make the very next
      // delta report the same file as changed again — a cutover that could
      // never converge.
      sourceSize: outcome.destinationSize ?? null,
      sourceHash: outcome.destinationHash ?? null,
    })
  }

  let removed = 0
  for (const entry of remove) {
    // ONLY WHAT THIS MIGRATION CREATED reaches this loop; `planReconciliation`
    // filters on ownership, and an object that predates the migration is
    // somebody else's file.
    try {
      if (entry.kind === "directory") await destination.deletePrefix(entry.key)
      else await destination.deleteObject(entry.key)
      removed += 1
      await repository.saveOutcome(job.id, entry.key, {
        state: "reconciled",
        detail: "Deleted from the source before the cutover; the copy FlowCMS made was removed.",
      })
    } catch {
      failures.push(`${entry.key}: the stale copy at the destination could not be removed`)
    }
  }

  return {
    summary: {
      copied: outcomes.filter((o) => o.state === "verified").length,
      removed,
      retainedAsExtra: 0,
      unchanged: 0,
    },
    failures,
  }
}

/**
 * Brings the entry rows into line with what the reconciliation just did.
 *
 * WITHOUT THIS, A COMPLETED MIGRATION LOOKS BLOCKED. The rows still say
 * "changed at the source" and "deleted at the source" — the two states
 * `assessReadiness` refuses to cut over on — and a restart between here and the
 * commit would read them and conclude the job was not ready, for work that has
 * already been done.
 */
async function restateBaseline(
  job: MigrationRow,
  delta: { entries: DeltaEntry[] },
  retainAsExtra: DeltaEntry[],
  deps: CutoverDeps,
): Promise<void> {
  const { repository } = deps

  for (const entry of retainAsExtra) {
    // The source object is gone and the destination copy is not ours. It stays,
    // and it is now exactly what a destination-only extra is.
    await repository.saveOutcome(job.id, entry.key, {
      state: "reconciled",
      classification: "destination_only",
      detail:
        "This was deleted from the source before the cutover. FlowCMS did not create the copy at " +
        "the destination, so it has been left alone and will be visible in the File Manager.",
    })
  }

  // Entries the delta found unchanged but whose row still records an unresolved
  // difference. The delta is the newer statement and it says they agree.
  for (const entry of delta.entries) {
    if (entry.change !== "unchanged") continue
    const row = await repository.findEntry(job.id, entry.key)
    if (!row) continue
    if (row.state === "source_changed" || row.state === "source_deleted") {
      await repository.saveOutcome(job.id, entry.key, {
        state: "verified",
        createdByMigration: row.createdByMigration,
        destinationSize: row.destinationSize,
        destinationHash: row.destinationHash,
      })
    }
  }
}

/**
 * Releases the lock, and refuses to when releasing would be a guess.
 *
 * The release is CONDITIONAL ON THE ACTIVE TOPOLOGY STILL BEING THE SOURCE.
 * That is the only state in which "nothing was switched" is a fact rather than
 * an assumption — if the installation has already moved to the destination,
 * putting the job back to `ready_to_cutover` would describe a cutover that
 * could still be run, about an installation that has already had one.
 */
async function release(
  deps: CutoverDeps,
  migrationId: string,
  refusal: CutoverRefusal,
  reasons: string[],
): Promise<CutoverResult> {
  const active = await deps.activeLocationId().catch(() => null)
  const job = await deps.repository.findById(migrationId)

  if (!job || active !== job.sourceLocationId) {
    return {
      outcome: "needs_recovery",
      reasons: [
        ...reasons,
        "FlowCMS could not confirm that the storage location is unchanged, so it has stopped " +
          "rather than guess. Reload to see the recovery state.",
      ],
    }
  }

  try {
    await deps.repository.transition(job.id, job.version, "ready_to_cutover", {
      cutoverStartedAt: null,
      failureReason: reasons[0] ?? null,
    } as Partial<MigrationRow>)
  } catch {
    return { outcome: "needs_recovery", reasons }
  }

  return { outcome: "aborted", refusal, reasons }
}

function expired(started: Date, windowMs: number, now: Date = new Date()): boolean {
  return now.getTime() - started.getTime() > windowMs
}

function windowMessage(): string {
  return (
    "The cutover took longer than its safe window and was stopped. Storage has been unlocked and " +
    "nothing was switched — this is not data loss. Run the migration again to pick up the changes " +
    "and try the cutover once it has less to catch up on."
  )
}

function describeStatus(status: string): string {
  switch (status) {
    case "draft":
      return "still being configured"
    case "destination_tested":
      return "waiting for its inventory to run"
    case "inventorying":
      return "still taking inventory"
    case "blocked":
      return "blocked on something that needs resolving"
    case "ready":
      return "analysed but has not transferred anything yet"
    case "copying":
      return "still transferring"
    case "verifying":
      return "still verifying"
    case "cutting_over":
      return "already cutting over"
    case "completed":
      return "already complete"
    default:
      return status
  }
}

/** Never the raw error: it can carry a bucket, an endpoint, or a credential. */
function describeUnexpected(error: unknown): string {
  const name = (error as { name?: string })?.name ?? ""
  if (name === "StorageObjectNotFoundError") return "A file disappeared from the source mid-cutover."
  if (name === "CutoverRefusedError") return "The final transaction was refused."
  return "An unexpected error stopped the cutover."
}

export { windowExpired }
