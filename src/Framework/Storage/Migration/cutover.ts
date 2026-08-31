import { and, eq } from "drizzle-orm"
import { db } from "@/db/client"
import { affectedRowCount } from "@/db/writes"
import { settings, storageMigrations } from "@/db/tables"
import { SETTINGS_SINGLETON_ID } from "@/db/schema/settings"
import { invalidateSettingsCache } from "@/Framework/Settings/SettingsService"
import { storageLocationId, type ResolvedStorageConfig } from "../storageConfig"
import type { MigrationRow } from "./migrationRepository"

/**
 * THE MOMENT THE DESTINATION BECOMES AUTHORITATIVE.
 *
 * Everything before this point is reversible by doing nothing: an abandoned
 * migration leaves a live source, a destination nobody reads, and a job row.
 * This module contains the one operation that is not, so its entire design is
 * about making the irreversible step atomic and the reversible steps ordered
 * around it correctly.
 *
 *     acquire lock                 storage mutations stop
 *       -> final delta             the source is frozen, so this is a real answer
 *       -> final verification      prove the destination represents it
 *       -> ONE TRANSACTION         active topology + credentials + job state
 *       -> invalidate caches       so the next read resolves the new location
 *       -> release lock            mutations resume, against the destination
 *
 * THE INVARIANT, stated once and enforced everywhere below:
 *
 *   Until the transaction commits, the SOURCE is authoritative. A failure at
 *   any earlier step — lock, delta, verification, credentials, the transaction
 *   itself, or a process death — leaves an installation serving exactly what it
 *   served before.
 *
 * WHAT THE LOCK HONESTLY DOES NOT DO. It cannot cancel a mutation already in
 * flight when it was taken. That is precisely why the final delta runs AFTER
 * acquisition rather than before: the lock narrows the window, and the delta
 * closes it by looking at what is actually there once nothing new can start.
 */

/**
 * How long the critical window may last before the cutover gives up.
 *
 * Every storage mutation in the application is refused while it is open, so an
 * unbounded window is an unbounded outage. An enormous final delta is a signal
 * that the baseline is too stale to finish from — the right answer is to fall
 * back to the source and run another baseline pass, not to hold uploads down
 * for an hour hoping to catch up.
 */
export const CUTOVER_WINDOW_MS = 5 * 60 * 1000

/** How many entries the final delta will reconcile inside the window. */
export const MAX_FINAL_DELTA_ENTRIES = 500

export type CutoverRefusal =
  | "not_ready"
  | "window_exceeded"
  | "delta_too_large"
  | "verification_failed"
  | "already_committed_elsewhere"
  | "identity_unchanged"

export class CutoverRefusedError extends Error {
  readonly refusal: CutoverRefusal

  constructor(refusal: CutoverRefusal, message: string) {
    super(message)
    this.name = "CutoverRefusedError"
    this.refusal = refusal
  }
}

/** Rebuilds the destination configuration from the persisted job row. */
export function destinationConfigOf(job: MigrationRow): ResolvedStorageConfig {
  if (job.destinationDriver === "local") {
    return { driver: "local", root: job.destinationRoot ?? "" }
  }
  return {
    driver: "s3",
    endpoint: job.destinationEndpoint ?? undefined,
    region: job.destinationRegion ?? undefined,
    bucket: job.destinationBucket ?? "",
    accessKeyId: job.destinationAccessKeyId ?? "",
    secretAccessKey: job.destinationSecretAccessKey ?? "",
  }
}

/** Whether the critical window has been open too long. */
export function windowExpired(job: MigrationRow, now: Date = new Date()): boolean {
  if (!job.cutoverStartedAt) return false
  return now.getTime() - job.cutoverStartedAt.getTime() > CUTOVER_WINDOW_MS
}

/**
 * The single authoritative transaction.
 *
 * EVERYTHING THAT DEFINES "WHERE THE FILES ARE" MOVES TOGETHER: the active
 * topology snapshot, the credentials needed to reach it, and the job's terminal
 * state. Splitting them across separate writes is how an installation ends up
 * pointing at a bucket it has no key for, or completed according to its job row
 * and still serving the old location.
 *
 * CREDENTIALS TRAVEL WITH THE LOCATION, in the same statement. Switching the
 * active bucket without the key that opens it would produce an installation
 * that is authoritatively pointed somewhere it cannot read — a worse state than
 * either side of the migration.
 *
 * The migration's own credential copy is deliberately NOT cleared here. Until
 * this transaction commits, it is the only record of how to reach the
 * destination, and a recovery that ran after a partial failure would need it.
 * Clearing it is a separate step after the commit is known to have succeeded.
 */
/**
 * The pieces this transaction writes through.
 *
 * INJECTABLE, ADDED IN PHASE 4C AND FOR A REASON WORTH STATING. Phase 4b2 could
 * not test this function: it closed over the application database, so the live
 * end-to-end run had to reimplement the transaction inline and assert on the
 * copy — which proves the shape of a transaction that is not the one that runs
 * in production. With the executor as a parameter, the same code an
 * installation cuts over with is the code the test drives against a real
 * temporary database.
 *
 * The default is the real application, so nothing about a production cutover
 * changes.
 */
export interface CutoverStore {
  db: typeof db
  settings: typeof settings
  migrations: typeof storageMigrations
  invalidate: () => Promise<void>
}

function defaultStore(): CutoverStore {
  return { db, settings, migrations: storageMigrations, invalidate: invalidateSettingsCache }
}

export async function commitCutover(
  job: MigrationRow,
  destination: ResolvedStorageConfig,
  store: CutoverStore = defaultStore(),
): Promise<void> {
  const { settings, migrations: storageMigrations } = store
  const locationId = storageLocationId(destination)
  const now = new Date()

  await store.db.transaction(async (tx) => {
    const activeColumns: Record<string, unknown> = {
      activeStorageDriver: destination.driver,
      activeStorageLocationId: locationId,
      activeStorageEndpoint: destination.driver === "s3" ? (destination.endpoint ?? null) : null,
      activeStorageRegion: destination.driver === "s3" ? (destination.region ?? null) : null,
      activeStorageBucket: destination.driver === "s3" ? destination.bucket : null,
      activeStorageRoot: destination.driver === "local" ? destination.root : null,
      activeStorageEstablishedAt: now,
      updatedAt: now,
    }

    if (destination.driver === "s3") {
      // The endpoint/region/bucket and the credentials for them are one fact.
      activeColumns.s3Endpoint = destination.endpoint ?? null
      activeColumns.s3Region = destination.region ?? null
      activeColumns.s3Bucket = destination.bucket
      activeColumns.s3AccessKeyId = destination.accessKeyId || null
      activeColumns.s3SecretAccessKey = destination.secretAccessKey || null
    }

    await tx.update(settings).set(activeColumns).where(eq(settings.id, SETTINGS_SINGLETON_ID))

    // GUARDED ON THE JOB'S VERSION AND STATUS. A second cutover request that
    // got this far concurrently matches no row, so it cannot commit a second
    // switch on top of the first.
    const result = await tx
      .update(storageMigrations)
      .set({
        status: "completed",
        version: job.version + 1,
        cutoverAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(storageMigrations.id, job.id),
          eq(storageMigrations.version, job.version),
          eq(storageMigrations.status, "cutting_over"),
        ),
      )

    if (affectedRowCount(result) !== 1) {
      // Rolls back the settings update with it. The whole point of one
      // transaction: an installation cannot be repointed by a cutover whose job
      // record did not also complete.
      throw new CutoverRefusedError(
        "already_committed_elsewhere",
        "This migration changed while the cutover was running; nothing was switched.",
      )
    }
  })

  // AFTER the commit, never before. A cache cleared for a change that then
  // rolled back is one extra database read; a cache left stale after a
  // successful cutover serves the OLD location until it expires, which is
  // exactly the window in which writes would go to the wrong place.
  //
  // If this throws, the database already says destination — and that is the
  // authority. Recovery re-invalidates rather than reverting, because reverting
  // after the destination became authoritative could lose writes made to it.
  await store.invalidate()
}

/**
 * What a restart should conclude, from durable facts alone.
 *
 * The question a recovering process must answer is "which storage is
 * authoritative right now", and the answer is NOT derivable from the migration
 * job's status: a crash between the transaction committing and the job being
 * observed leaves a row that says `cutting_over` about an installation that has
 * already moved.
 *
 * The active snapshot is the fact. The job status is a description of an
 * attempt. When they disagree, the snapshot wins and the job is repaired to
 * match — never the other way round.
 */
export type RecoveryVerdict =
  /** No cutover was in progress. */
  | { outcome: "idle" }
  /** A cutover was interrupted before committing. Source is still authoritative. */
  | { outcome: "interrupted_before_commit"; migrationId: string }
  /** The switch committed; the job row just never caught up. Finish the paperwork. */
  | { outcome: "committed_needs_finalising"; migrationId: string }
  /** The active topology is neither source nor destination. Do not guess. */
  | { outcome: "unexpected_topology"; migrationId: string }

export function assessRecovery(
  job: Pick<
    MigrationRow,
    "id" | "status" | "sourceLocationId" | "destinationLocationId"
  > | null,
  activeLocationId: string | null,
): RecoveryVerdict {
  if (!job || job.status !== "cutting_over") return { outcome: "idle" }

  if (activeLocationId === job.destinationLocationId) {
    // The transaction committed. Whatever the job row says, the files are at
    // the destination and reverting would discard anything written there since.
    return { outcome: "committed_needs_finalising", migrationId: job.id }
  }

  if (activeLocationId === job.sourceLocationId) {
    // The switch never happened. The source is live and intact; the cutover can
    // be retried from the beginning of its critical section.
    return { outcome: "interrupted_before_commit", migrationId: job.id }
  }

  // Neither. Something outside this migration changed the topology, and there
  // is no safe guess: switching either way could be the wrong one. Report and
  // stop, leaving writes blocked, rather than silently choosing.
  return { outcome: "unexpected_topology", migrationId: job.id }
}

/**
 * Clears the job's copy of the destination credentials.
 *
 * ONLY AFTER the commit, and only once the authoritative settings row holds
 * them — before that the job copy is the sole record of how to reach the
 * destination, and a recovery would need it.
 *
 * Cleared rather than kept because a duplicate secret at rest is a second place
 * for it to leak from, and after cutover it is redundant: the same credentials
 * now live in the settings row that every other part of FlowCMS reads.
 */
export async function clearMigrationCredentials(
  migrationId: string,
  store: CutoverStore = defaultStore(),
): Promise<void> {
  const storageMigrations = store.migrations
  await store.db
    .update(storageMigrations)
    .set({ destinationAccessKeyId: null, destinationSecretAccessKey: null, updatedAt: new Date() })
    .where(and(eq(storageMigrations.id, migrationId), eq(storageMigrations.status, "completed")))
}
