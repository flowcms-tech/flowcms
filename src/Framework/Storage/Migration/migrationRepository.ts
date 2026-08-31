import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm"
import { upsert } from "@/db/writes"
import type { db as AppDb } from "@/db/client"
import type { storageMigrations as MigrationsTable, storageMigrationEntries as EntriesTable } from "@/db/tables"
import {
  TERMINAL_STATUSES,
  canTransition,
  type MigrationMode,
  type MigrationStatus,
} from "./migrationState"

/**
 * DURABLE MIGRATION STATE.
 *
 * The state machine's rules live in `migrationState.ts` as pure functions; this
 * is where they meet the database. The split matters: policy can be exhausted
 * in tests without a database, and every write that could move a job goes
 * through one narrow set of functions that all enforce the same two guards.
 *
 * GUARD ONE — LEGALITY. A transition not in the table is refused before any SQL
 * runs.
 *
 * GUARD TWO — OPTIMISTIC CONCURRENCY. Every write is conditioned on the
 * `version` it read. Two callers advancing the same job — an operator
 * double-clicking, two replicas polling the same batch, a retry racing the
 * request it is retrying — cannot both win: the second matches no row and is
 * told the job moved underneath it. Without this, two callers could each read
 * `ready`, each decide to start copying, and both begin.
 *
 * NOTHING HERE COPIES, DELETES OR CUTS OVER. It records what is true.
 */

/** Injected so tests can drive a real temporary database. */
export interface MigrationRepositoryDeps {
  db: typeof AppDb
  migrations: typeof MigrationsTable
  entries: typeof EntriesTable
}

export type MigrationRow = typeof MigrationsTable.$inferSelect

/** Raised when a transition is refused. Carries why, so callers can report it. */
export class MigrationTransitionError extends Error {
  readonly reason: "illegal_transition" | "version_conflict" | "not_found"

  constructor(reason: MigrationTransitionError["reason"], message: string) {
    super(message)
    this.name = "MigrationTransitionError"
    this.reason = reason
  }
}

/** Raised when a second relocation is attempted while one is open. */
export class MigrationAlreadyActiveError extends Error {
  readonly activeId: string

  constructor(activeId: string) {
    super(
      "A storage migration is already in progress. Finish or cancel it before starting another.",
    )
    this.name = "MigrationAlreadyActiveError"
    this.activeId = activeId
  }
}

export function createMigrationRepository(deps: MigrationRepositoryDeps) {
  const { db, migrations, entries } = deps

  /** The open job, if any. At most one may exist. */
  async function findActive(): Promise<MigrationRow | null> {
    const rows = await db
      .select()
      .from(migrations)
      .where(notInArray(migrations.status, [...TERMINAL_STATUSES]))
      .limit(1)
    return (rows[0] as MigrationRow | undefined) ?? null
  }

  async function findById(id: string): Promise<MigrationRow | null> {
    const rows = await db.select().from(migrations).where(eq(migrations.id, id)).limit(1)
    return (rows[0] as MigrationRow | undefined) ?? null
  }

  /**
   * Opens a job, refusing if one is already open.
   *
   * The check and the insert run in a TRANSACTION. Checking first and inserting
   * afterwards leaves a window in which two requests both see nothing and both
   * insert — and two concurrent relocations would each copy to their own
   * destination while the other mutated the source, so each final delta would
   * be computed against a baseline the other had invalidated.
   */
  async function create(input: {
    mode: MigrationMode
    source: TopologySnapshot
    destination: TopologySnapshot
    destinationAccessKeyId?: string | null
    destinationSecretAccessKey?: string | null
  }): Promise<MigrationRow> {
    return db.transaction(async (tx) => {
      const open = await tx
        .select({ id: migrations.id })
        .from(migrations)
        .where(notInArray(migrations.status, [...TERMINAL_STATUSES]))
        .limit(1)

      if (open[0]) throw new MigrationAlreadyActiveError(open[0].id as string)

      const now = new Date()
      // THE ID IS GENERATED HERE, not read back afterwards. Selecting the row
      // by "most recently created" would be wrong the moment two jobs share a
      // millisecond, and `.returning()` is not portable — SQLite and PostgreSQL
      // support it, MySQL and MariaDB do not, and this repository has to work
      // on all four.
      const id = crypto.randomUUID()
      const row = {
        id,
        status: "draft" as MigrationStatus,
        mode: input.mode,
        sourceDriver: input.source.driver,
        sourceLocationId: input.source.locationId,
        sourceEndpoint: input.source.endpoint ?? null,
        sourceRegion: input.source.region ?? null,
        sourceBucket: input.source.bucket ?? null,
        sourceRoot: input.source.root ?? null,
        destinationDriver: input.destination.driver,
        destinationLocationId: input.destination.locationId,
        destinationEndpoint: input.destination.endpoint ?? null,
        destinationRegion: input.destination.region ?? null,
        destinationBucket: input.destination.bucket ?? null,
        destinationRoot: input.destination.root ?? null,
        destinationAccessKeyId: input.destinationAccessKeyId ?? null,
        destinationSecretAccessKey: input.destinationSecretAccessKey ?? null,
        createdAt: now,
        updatedAt: now,
      }

      await tx.insert(migrations).values(row)
      const created = await tx.select().from(migrations).where(eq(migrations.id, id)).limit(1)
      return created[0] as MigrationRow
    })
  }

  /**
   * Moves a job to a new status, and optionally writes progress with it.
   *
   * Returns the updated row, or throws. It never returns a row that was not
   * written: a caller that got a row back knows its transition is the one that
   * committed, which is what makes "advance one batch" safe to retry.
   */
  async function transition(
    id: string,
    expectedVersion: number,
    to: MigrationStatus,
    patch: Partial<MigrationRow> = {},
  ): Promise<MigrationRow> {
    const current = await findById(id)
    if (!current) throw new MigrationTransitionError("not_found", "That migration no longer exists.")

    if (!canTransition(current.status as MigrationStatus, to)) {
      throw new MigrationTransitionError(
        "illegal_transition",
        `A migration cannot go from ${current.status} to ${to}.`,
      )
    }

    const result = await db
      .update(migrations)
      .set({
        ...patch,
        status: to,
        version: expectedVersion + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(migrations.id, id), eq(migrations.version, expectedVersion)))

    const affected = (result as unknown as { rowsAffected?: number; rowCount?: number })
    if ((affected.rowsAffected ?? affected.rowCount ?? 0) !== 1) {
      throw new MigrationTransitionError(
        "version_conflict",
        "That migration changed while this request was working on it. Reload and try again.",
      )
    }

    return (await findById(id))!
  }

  /**
   * Records inventory progress WITHOUT changing status.
   *
   * Separate from `transition` because an inventory batch is the same status
   * repeated, and forcing it through a status change would make "still
   * inventorying" indistinguishable from "started inventorying".
   */
  async function saveProgress(
    id: string,
    expectedVersion: number,
    patch: Partial<MigrationRow>,
  ): Promise<MigrationRow> {
    return transition(id, expectedVersion, "inventorying", patch)
  }

  /**
   * Records one scanned entry, idempotently.
   *
   * UPSERT, not insert. Inventory is resumable and retryable, so the same key
   * legitimately arrives more than once — after a restart mid-batch, or a
   * retried request. Without the unique `(migrationId, key)` index and this
   * conflict clause, each retry would insert a duplicate row, inflating every
   * count and handing the copy phase the same object twice.
   */
  async function recordEntry(
    migrationId: string,
    entry: {
      key: string
      kind: "file" | "directory"
      classification: string
      state: string
      sourceSize?: number | null
      sourceLastModified?: Date | null
      sourceETag?: string | null
      sourceHash?: string | null
      destinationSize?: number | null
      destinationHash?: string | null
      detail?: string | null
    },
  ): Promise<void> {
    const now = new Date()
    const values = {
      migrationId,
      key: entry.key,
      kind: entry.kind,
      classification: entry.classification,
      state: entry.state,
      sourceSize: entry.sourceSize ?? null,
      sourceLastModified: entry.sourceLastModified ?? null,
      sourceETag: entry.sourceETag ?? null,
      sourceHash: entry.sourceHash ?? null,
      destinationSize: entry.destinationSize ?? null,
      destinationHash: entry.destinationHash ?? null,
      detail: entry.detail ?? null,
      updatedAt: now,
    }

    // Through `upsert()`, NOT `onConflictDoUpdate` directly.
    // `onConflictDoUpdate` is SQLite/PostgreSQL syntax; MySQL and MariaDB spell
    // it `ON DUPLICATE KEY UPDATE`, so writing it here would work on two of the
    // four supported engines and fail at runtime on the other two.
    // `dialectIsolation.test.ts` enforces that, and caught exactly this.
    await upsert(
      entries,
      values as never,
      {
        target: [entries.migrationId, entries.key],
        executor: db,
        set: {
          kind: values.kind,
          classification: values.classification,
          state: values.state,
          sourceSize: values.sourceSize,
          sourceLastModified: values.sourceLastModified,
          sourceETag: values.sourceETag,
          sourceHash: values.sourceHash,
          destinationSize: values.destinationSize,
          destinationHash: values.destinationHash,
          detail: values.detail,
          updatedAt: now,
        },
      },
    )
  }

  async function countEntries(migrationId: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)` })
      .from(entries)
      .where(eq(entries.migrationId, migrationId))
    return Number(rows[0]?.n ?? 0)
  }

  async function entriesByClassification(
    migrationId: string,
    classification: string,
  ): Promise<(typeof EntriesTable.$inferSelect)[]> {
    return db
      .select()
      .from(entries)
      .where(and(eq(entries.migrationId, migrationId), eq(entries.classification, classification)))
  }

  /**
   * Takes ownership of up to `limit` entries that still need work.
   *
   * A CONDITIONAL UPDATE IS THE CLAIM. Selecting rows and then working on them
   * leaves a window in which a second caller selects the same rows; moving them
   * to `copying` in the same statement that matches `pending` means only one
   * caller can win each entry.
   *
   * Reclaims a stale lease as well: an entry left `copying` by a process that
   * died would otherwise be stranded forever, and one reclaimed too eagerly
   * would have two workers streaming to the same key — which on a filesystem
   * interleaves into corruption rather than a harmless duplicate write. The
   * lease age is what separates those two cases.
   *
   * Returns the claimed rows, already marked, so the caller can execute them
   * knowing nobody else will.
   */
  async function claimEntries(
    migrationId: string,
    runId: string,
    limit: number,
    options: { leaseMs?: number } = {},
  ): Promise<(typeof EntriesTable.$inferSelect)[]> {
    const leaseMs = options.leaseMs ?? 15 * 60 * 1000
    const staleBefore = new Date(Date.now() - leaseMs)

    const candidates = await db
      .select()
      .from(entries)
      .where(
        and(
          eq(entries.migrationId, migrationId),
          // `pending` is unclaimed work. `failed` is retryable. `copying` and
          // `copied` are recoverable — see the coordinator, which re-verifies
          // rather than blindly re-uploading.
          inArray(entries.state, ["pending", "failed", "copying", "copied"]),
        ),
      )
      .limit(limit * 2)

    const claimed: (typeof EntriesTable.$inferSelect)[] = []
    for (const row of candidates) {
      if (claimed.length >= limit) break

      const heldByOther =
        row.claimedBy !== null &&
        row.claimedBy !== runId &&
        row.claimedAt !== null &&
        row.claimedAt > staleBefore
      if (heldByOther) continue

      const result = await db
        .update(entries)
        .set({ claimedBy: runId, claimedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(entries.id, row.id),
            // Guarded on the claim we READ, so two callers racing for the same
            // row cannot both succeed.
            row.claimedBy === null
              ? isNull(entries.claimedBy)
              : eq(entries.claimedBy, row.claimedBy),
          ),
        )

      const affected = result as unknown as { rowsAffected?: number; rowCount?: number }
      if ((affected.rowsAffected ?? affected.rowCount ?? 0) === 1) {
        claimed.push({ ...row, claimedBy: runId })
      }
    }

    return claimed
  }

  /**
   * Writes what happened to one entry.
   *
   * The claim is RELEASED here, so a retry after a crash mid-execute finds the
   * entry claimable again rather than stranded behind its own lease.
   */
  async function saveOutcome(
    migrationId: string,
    key: string,
    outcome: {
      state: string
      createdByMigration?: boolean
      destinationSize?: number | null
      destinationHash?: string | null
      detail?: string | null
      incrementAttempts?: boolean
    },
  ): Promise<void> {
    const patch: Record<string, unknown> = {
      state: outcome.state,
      destinationSize: outcome.destinationSize ?? null,
      destinationHash: outcome.destinationHash ?? null,
      detail: outcome.detail ?? null,
      claimedBy: null,
      claimedAt: null,
      updatedAt: new Date(),
    }

    // OWNERSHIP IS ONLY EVER SET, NEVER CLEARED. Once this migration has
    // written a destination object the fact is permanent: the final
    // reconciliation may remove only what it created, and losing that flag
    // would either strand a stale object or license deleting somebody else's.
    if (outcome.createdByMigration) patch.createdByMigration = true

    if (outcome.incrementAttempts) {
      patch.attempts = sql`${entries.attempts} + 1`
    }

    await db
      .update(entries)
      .set(patch)
      .where(and(eq(entries.migrationId, migrationId), eq(entries.key, key)))
  }

  /** Counts per execution state, for progress and the readiness gate. */
  async function countByState(migrationId: string): Promise<Record<string, number>> {
    const rows = await db
      .select({ state: entries.state, n: sql<number>`count(*)` })
      .from(entries)
      .where(eq(entries.migrationId, migrationId))
      .groupBy(entries.state)

    const out: Record<string, number> = {}
    for (const row of rows) out[String(row.state)] = Number(row.n)
    return out
  }

  /** Counts per classification. */
  async function countByClassification(migrationId: string): Promise<Record<string, number>> {
    const rows = await db
      .select({ classification: entries.classification, n: sql<number>`count(*)` })
      .from(entries)
      .where(eq(entries.migrationId, migrationId))
      .groupBy(entries.classification)

    const out: Record<string, number> = {}
    for (const row of rows) out[String(row.classification)] = Number(row.n)
    return out
  }

  /** Every entry this migration created at the destination. */
  async function ownedEntries(migrationId: string) {
    return db
      .select()
      .from(entries)
      .where(and(eq(entries.migrationId, migrationId), eq(entries.createdByMigration, true)))
  }

  async function findEntry(migrationId: string, key: string) {
    const rows = await db
      .select()
      .from(entries)
      .where(and(eq(entries.migrationId, migrationId), eq(entries.key, key)))
      .limit(1)
    return rows[0] ?? null
  }

  /** Cancelling is a transition like any other, and durable. */
  async function cancel(id: string, expectedVersion: number, reason?: string) {
    return transition(id, expectedVersion, "cancelled", {
      failureReason: reason ?? null,
    } as Partial<MigrationRow>)
  }

  return {
    findActive,
    findById,
    create,
    transition,
    saveProgress,
    recordEntry,
    countEntries,
    entriesByClassification,
    claimEntries,
    saveOutcome,
    countByState,
    countByClassification,
    ownedEntries,
    findEntry,
    cancel,
  }
}

/** The location half of a topology — never credentials. */
export interface TopologySnapshot {
  driver: string
  locationId: string
  endpoint?: string | null
  region?: string | null
  bucket?: string | null
  root?: string | null
}

export type MigrationRepository = ReturnType<typeof createMigrationRepository>
export { TERMINAL_STATUSES, inArray }
