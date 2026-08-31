import { assessRecovery, windowExpired, type RecoveryVerdict } from "./cutover"
import type { MigrationRepository, MigrationRow } from "./migrationRepository"

/**
 * WHAT A PROCESS THAT DID NOT START THE CUTOVER SHOULD DO ABOUT ONE.
 *
 * Phase 4b2 built `assessRecovery`, which answers "which storage is
 * authoritative right now" from durable facts alone, and nothing called it. A
 * verdict nobody acts on is a comment.
 *
 * The property this has to have, and the one that decides where it is wired in:
 *
 *   RECOVERY MUST NOT DEPEND ON AN ADMIN PAGE BEING OPEN.
 *
 * An interrupted cutover leaves a job in `cutting_over`, and that job is the
 * write lock — every upload in the application is refused while it stands. If
 * the only thing that could clear it were somebody visiting the storage
 * settings screen, then a crash during a cutover would take uploads down until
 * a human happened to look, and the person best placed to notice is the one
 * whose uploads have stopped working.
 *
 * So it runs from three places, all of them server-side and none of them a
 * page: at startup, whenever a storage write is refused because of the lock,
 * and whenever the migration state is read. Each is idempotent, so running it
 * three times is running it once.
 *
 * WHAT IT WILL NOT DO. It never chooses a topology. `unexpected_topology` — the
 * active location is neither this migration's source nor its destination —
 * stops here and is reported, because both repairs are destructive if they are
 * the wrong one and there is no evidence to pick between them.
 */

export interface RecoveryDeps {
  repository: MigrationRepository
  /** Where the installation says its files are. The durable fact. */
  activeLocationId: () => Promise<string | null>
  /** Clears the job's duplicate copy of the destination credentials. */
  clearCredentials: (migrationId: string) => Promise<void>
  /** So the next read resolves the location the commit established. */
  invalidateCaches: () => Promise<void>
}

export type RecoverySeverity = "none" | "info" | "critical"

export interface RecoveryReport {
  outcome: RecoveryVerdict["outcome"]
  migrationId: string | null
  /** What this run actually did. Empty when it decided to do nothing. */
  actions: string[]
  /** Operator-facing. Never contains a credential, a bucket or an endpoint. */
  message: string | null
  severity: RecoverySeverity
}

const IDLE: RecoveryReport = {
  outcome: "idle",
  migrationId: null,
  actions: [],
  message: null,
  severity: "none",
}

/**
 * Inspects the open migration, if any, and repairs what is safe to repair.
 *
 * Safe to call concurrently and repeatedly: every write it makes is a
 * conditional transition, so a second caller that lost the race is told the job
 * moved and reaches the same conclusion on its next run.
 */
export async function reconcileStorageRecovery(deps: RecoveryDeps): Promise<RecoveryReport> {
  const job = await deps.repository.findActive()
  const active = await deps.activeLocationId().catch(() => null)
  const verdict = assessRecovery(job, active)

  switch (verdict.outcome) {
    case "idle":
      return IDLE

    case "interrupted_before_commit":
      return recoverInterrupted(job!, deps)

    case "committed_needs_finalising":
      return finaliseCommitted(job!, deps)

    case "unexpected_topology":
      // DO NOT GUESS, DO NOT CLEAR THE LOCK. Something outside this migration
      // moved the active topology; switching it either way could be the wrong
      // one, and the lock is the only thing currently stopping writes from
      // landing somewhere nothing will look for them.
      return {
        outcome: "unexpected_topology",
        migrationId: verdict.migrationId,
        actions: [],
        severity: "critical",
        message:
          "Storage state does not match either the recorded source or the recorded destination " +
          "of the migration that is in progress. Automatic recovery has stopped to avoid data " +
          "loss, and storage writes stay blocked until this is resolved by hand.",
      }
  }
}

/**
 * A cutover that was interrupted before its transaction committed.
 *
 * The source is live and intact. The only question is whether the process that
 * took the lock is still working — and the answer is the LEASE, not the status:
 * a cutover that started forty seconds ago is probably still running in another
 * request or another replica, and clearing its lock underneath it would let
 * writes land at the source in the middle of the final delta, which is the
 * precise thing the lock exists to prevent.
 *
 * So a fresh lock is left alone and reported; only one older than the window it
 * was allowed to take is released.
 */
async function recoverInterrupted(job: MigrationRow, deps: RecoveryDeps): Promise<RecoveryReport> {
  if (!windowExpired(job)) {
    return {
      outcome: "interrupted_before_commit",
      migrationId: job.id,
      actions: [],
      severity: "info",
      message:
        "A cutover is in progress. Storage is briefly read-only while it finishes; the original " +
        "storage is still active until it commits.",
    }
  }

  try {
    await deps.repository.transition(job.id, job.version, "ready_to_cutover", {
      cutoverStartedAt: null,
      failureReason:
        "The previous cutover was interrupted before storage changed. Nothing was switched.",
    } as Partial<MigrationRow>)
  } catch {
    // Somebody else got there first, or the job moved. Either way the next run
    // reads the newer state and reaches the same conclusion.
    return {
      outcome: "interrupted_before_commit",
      migrationId: job.id,
      actions: [],
      severity: "info",
      message: "The interrupted cutover is being cleaned up.",
    }
  }

  return {
    outcome: "interrupted_before_commit",
    migrationId: job.id,
    actions: ["released the stale cutover lock"],
    severity: "info",
    message:
      "The previous cutover was interrupted before storage changed. The original source is " +
      "still active, storage writes have been unblocked, and the cutover can be run again.",
  }
}

/**
 * The transaction committed; only the paperwork is outstanding.
 *
 * NEVER REVERTS. The destination is authoritative and may already have been
 * written to since, so going back would discard those writes. Everything here
 * moves the record forward to match the topology, in the order that makes each
 * step safe to lose:
 *
 *   1. invalidate caches      so reads resolve the new location immediately
 *   2. finalise the job       which also releases the write lock
 *   3. clear the credentials  now redundant; the settings row holds them
 *
 * If the process dies between any two, the next run starts again from step one
 * and reaches the same place.
 */
async function finaliseCommitted(job: MigrationRow, deps: RecoveryDeps): Promise<RecoveryReport> {
  const actions: string[] = []

  await deps.invalidateCaches().catch(() => {})
  actions.push("re-resolved the active storage location")

  try {
    await deps.repository.transition(job.id, job.version, "completed", {
      cutoverAt: job.cutoverAt ?? new Date(),
      cutoverStartedAt: null,
    } as Partial<MigrationRow>)
    actions.push("marked the migration complete and released the write lock")
  } catch {
    return {
      outcome: "committed_needs_finalising",
      migrationId: job.id,
      actions,
      severity: "info",
      message: "The destination is already active. FlowCMS is completing the migration record.",
    }
  }

  await deps.clearCredentials(job.id).catch(() => {})
  actions.push("cleared the migration's temporary copy of the destination credentials")

  return {
    outcome: "committed_needs_finalising",
    migrationId: job.id,
    actions,
    severity: "info",
    message:
      "The destination is already active — the previous cutover committed. FlowCMS has finished " +
      "the migration record and unblocked storage writes.",
  }
}
