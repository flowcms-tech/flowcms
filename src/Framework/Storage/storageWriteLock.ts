import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db/client"
import { storageMigrations } from "@/db/tables"
import { triggerStorageRecovery } from "./storageRecoveryTrigger"

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
 *
 * IT FAILS CLOSED. If the lock state cannot be read, the mutation is refused.
 * The Phase 4 checkpoint failed OPEN on the reasoning that a database blip
 * should not take uploads down — which is true in isolation and wrong as a
 * safety property, because the one moment the answer matters most is a cutover,
 * and a cutover writes to the database constantly. "I could not tell whether a
 * cutover is running" and "a cutover is running" have to be treated the same,
 * or the guarantee is only as good as the database's worst minute.
 *
 * The cost is bounded and honest: while the database is unreachable, storage
 * mutations return a temporary maintenance response. Reads are untouched, so
 * the public site keeps serving — and an installation whose database is down
 * cannot render its admin panel to upload with anyway.
 */

/** Statuses during which storage must not be mutated through the active driver. */
const LOCKING_STATUSES = ["cutting_over"] as const

/** Raised instead of performing a mutation while a cutover is in progress. */
export class StorageWriteLockedError extends Error {
  /** So routes can answer 503 + Retry-After rather than a generic failure. */
  readonly retryAfterSeconds: number
  /** `locked` — a cutover is running. `unknown` — it could not be determined. */
  readonly verdict: "locked" | "unknown"

  constructor(verdict: "locked" | "unknown" = "locked") {
    super(
      verdict === "locked"
        ? "Storage is briefly read-only while this site finishes moving to its new storage " +
            "location. Try again in a moment."
        : // Deliberately vague about the cause and precise about the effect: the
          // operator cannot act on "the database was unreachable" mid-upload,
          // and the honest statement is that FlowCMS declined to risk it.
          "Storage is temporarily read-only because FlowCMS could not confirm it is safe to " +
            "write. Try again in a moment.",
    )
    this.name = "StorageWriteLockedError"
    this.retryAfterSeconds = 15
    this.verdict = verdict
  }
}

/**
 * Whether storage may be mutated right now.
 *
 * Three answers rather than two, because "no cutover is running" and "I cannot
 * tell" are different facts and only one of them is safe to write on.
 */
export type StorageWriteVerdict = "writable" | "locked" | "unknown"

export async function checkStorageWriteVerdict(): Promise<StorageWriteVerdict> {
  try {
    const row = await db.query.storageMigrations.findFirst({
      where: inArray(storageMigrations.status, [...LOCKING_STATUSES]),
      columns: { id: true },
    })
    return row ? "locked" : "writable"
  } catch {
    // FAILS CLOSED. See the note at the top of this file: the moment this
    // answer matters most is a cutover, and a cutover is writing to the
    // database throughout — so a database failure is exactly when a stale
    // "unlocked" would do the damage.
    return "unknown"
  }
}

/** Convenience for callers that only need the boolean. */
export async function isStorageWriteLocked(): Promise<boolean> {
  return (await checkStorageWriteVerdict()) !== "writable"
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
  const verdict = await checkStorageWriteVerdict()
  if (verdict === "writable") return

  if (verdict === "locked") {
    // THE ONE MOMENT A STALE LOCK IS DEMONSTRABLY DOING HARM. A cutover whose
    // process died leaves this lock standing, and every upload in the
    // application is refused until something clears it. Asking for a recovery
    // pass here means the installation heals itself on the next attempted
    // write, with no admin page open and nobody having noticed yet.
    //
    // Fire and forget: the refusal below is not waiting on it, and a live
    // cutover — the common case — is left completely alone, because recovery
    // releases nothing whose lease is still current.
    triggerStorageRecovery()
  }

  throw new StorageWriteLockedError(verdict)
}

/**
 * Takes the lock by moving a job into `cutting_over`.
 *
 * A CONDITIONAL UPDATE, so two simultaneous cutover requests cannot both
 * proceed: the second matches no row and is told so. Returns whether the caller
 * now holds it.
 */
export async function acquireCutoverLock(
  migrationId: string,
  fromStatus: string,
  store: { db: typeof db; migrations: typeof storageMigrations } = {
    db,
    migrations: storageMigrations,
  },
): Promise<boolean> {
  const storageMigrations = store.migrations
  const result = await store.db
    .update(storageMigrations)
    // The timestamp is stamped BY the lock, in the same statement. Taking the
    // lock and recording when it was taken as two writes leaves a window in
    // which a restart finds a locked job with no idea how long it has been
    // locked — and "how long has this been going on" is the question that
    // decides whether to abort back to the source.
    .set({ status: "cutting_over", cutoverStartedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(storageMigrations.id, migrationId), eq(storageMigrations.status, fromStatus)))

  // The adapter reports affected rows; anything other than exactly one means
  // somebody else moved this job first.
  const changed = (result as unknown as { rowsAffected?: number; rowCount?: number })
  return (changed.rowsAffected ?? changed.rowCount ?? 0) === 1
}
