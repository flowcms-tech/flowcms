import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db/client"
import { storageMigrations } from "@/db/tables"

/**
 * Blocking storage mutations during the final moments of a cutover.
 *
 * WHY A LOCK IS NEEDED AT ALL. The baseline copy runs while the source is still
 * live, so an operator can upload, rename or delete a file while the migration
 * is halfway through. Those are fine — the final delta pass catches them. What
 * is not fine is a write landing BETWEEN the final delta check and the moment
 * the active topology flips: that file would be written to the old location, be
 * invisible at the new one, and nothing afterwards would ever look for it.
 *
 * So the window between "final check" and "switch" is closed to writes.
 *
 * WHY IT IS IN THE DATABASE AND NOT A MODULE VARIABLE. An in-process flag locks
 * one Node process. FlowCMS's own documentation contemplates more than one
 * replica (that is what the Redis rate limiter exists for), and a second replica
 * would happily keep accepting uploads throughout another replica's cutover.
 * The job row is already durable and already shared, so the lock is simply
 * "is there a job in `cutting_over`" — no new infrastructure, and it survives a
 * restart, which an in-process flag emphatically does not.
 *
 * WHAT THIS HONESTLY DOES NOT DO. It does not interrupt a mutation that is
 * ALREADY in flight when the lock is taken. A large upload that began a moment
 * earlier will finish and land on the source. That is why the final delta runs
 * UNDER the lock rather than before it, and why cutover re-verifies afterwards
 * — the lock narrows the window, the delta closes it.
 *
 * NOT CACHED, DELIBERATELY. One indexed query per mutation is nothing beside
 * the object-store round trip it precedes, and any cache at all would create a
 * staleness window during which writes slip through exactly when they must not.
 */

/** Statuses during which storage must not be mutated through the active driver. */
const LOCKING_STATUSES = ["cutting_over"] as const

/** Raised instead of performing a mutation while a cutover is in progress. */
export class StorageWriteLockedError extends Error {
  /** So routes can answer 503 + Retry-After rather than a generic failure. */
  readonly retryAfterSeconds: number

  constructor() {
    super(
      "Storage is briefly read-only while this site finishes moving to its new storage location. " +
        "Try again in a moment.",
    )
    this.name = "StorageWriteLockedError"
    this.retryAfterSeconds = 15
  }
}

/**
 * Whether a cutover currently holds the lock.
 *
 * Fails OPEN on a database error, and that is a deliberate trade. Failing
 * closed would mean a database hiccup makes every upload in the application
 * fail with a message about a migration that is not running — turning a
 * transient blip into a total outage of a feature nobody was migrating. The
 * risk it accepts is narrow: a write slipping into the cutover window during a
 * simultaneous database failure, which the cutover's own final verification
 * would then catch and refuse to complete on.
 */
export async function isStorageWriteLocked(): Promise<boolean> {
  try {
    const row = await db.query.storageMigrations.findFirst({
      where: inArray(storageMigrations.status, [...LOCKING_STATUSES]),
      columns: { id: true },
    })
    return Boolean(row)
  } catch {
    return false
  }
}

/**
 * Throws if storage is locked. Called by every mutating `StorageService` method.
 *
 * The gate lives in `StorageService` rather than in the nine File Manager
 * routes because the routes are not the boundary — they are nine of the current
 * callers. A tenth added later would arrive unguarded, which is precisely how
 * the pre-Phase-1 authorization gap happened. `tests/framework/storageWriteLock.test.ts`
 * asserts that every mutating method is gated and every read is not.
 */
export async function assertStorageWritable(): Promise<void> {
  if (await isStorageWriteLocked()) throw new StorageWriteLockedError()
}

/**
 * Takes the lock by moving a job into `cutting_over`.
 *
 * A CONDITIONAL UPDATE, so two simultaneous cutover requests cannot both
 * proceed: the second matches no row and is told so. Returns whether the caller
 * now holds it.
 */
export async function acquireCutoverLock(migrationId: string, fromStatus: string): Promise<boolean> {
  const result = await db
    .update(storageMigrations)
    .set({ status: "cutting_over", updatedAt: new Date() })
    .where(and(eq(storageMigrations.id, migrationId), eq(storageMigrations.status, fromStatus)))

  // The adapter reports affected rows; anything other than exactly one means
  // somebody else moved this job first.
  const changed = (result as unknown as { rowsAffected?: number; rowCount?: number })
  return (changed.rowsAffected ?? changed.rowCount ?? 0) === 1
}
