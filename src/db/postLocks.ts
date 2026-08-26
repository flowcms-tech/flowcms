import { inArray } from "drizzle-orm"
import { db } from "./client"
import { blogPostLocks, users } from "@/db/tables"

/**
 * How long a lock stays valid without a heartbeat. The edit page refreshes
 * every 20s while open, so 60s tolerates a couple of missed beats (a slow
 * network, a backgrounded tab throttling timers) before treating a lock as
 * abandoned — the same margin WordPress's own post-locking uses relative to
 * its heartbeat interval.
 *
 * There is deliberately no cron-style purge of expired rows (this app has no
 * cron). A stale row is simply ignored by every read below and overwritten
 * the next time anyone acquires that post, so it costs nothing to leave
 * lying around — consistent with how `publishDueScheduledPosts` treats its
 * own due-but-unprocessed rows.
 */
export const LOCK_TTL_MS = 60_000

export interface ActiveLock {
  lockedBy: { id: string; name: string }
  lockedAt: Date
}

function isActive(lockedAt: Date, now: Date): boolean {
  return now.getTime() - lockedAt.getTime() < LOCK_TTL_MS
}

/** Batch lookup for list/detail responses — active locks only, keyed by
 *  postId. A stale lock is treated as if it doesn't exist. */
export async function getActiveLocksByPostIds(
  postIds: string[]
): Promise<Map<string, ActiveLock>> {
  if (postIds.length === 0) return new Map()

  const now = new Date()
  const rows = await db.query.blogPostLocks.findMany({
    where: inArray(blogPostLocks.postId, postIds),
  })
  const active = rows.filter((row) => isActive(row.lockedAt, now))
  if (active.length === 0) return new Map()

  const lockerIds = Array.from(new Set(active.map((row) => row.lockedById)))
  const lockers = await db.query.users.findMany({ where: inArray(users.id, lockerIds) })
  const lockerById = new Map(lockers.map((user) => [user.id, user]))

  const result = new Map<string, ActiveLock>()
  for (const row of active) {
    const locker = lockerById.get(row.lockedById)
    result.set(row.postId, {
      lockedBy: { id: row.lockedById, name: locker?.name ?? "" },
      lockedAt: row.lockedAt,
    })
  }
  return result
}

/** Single-post version of the above, for the detail GET and the mutation
 *  guards below. */
export async function getActiveLock(postId: string): Promise<ActiveLock | null> {
  const map = await getActiveLocksByPostIds([postId])
  return map.get(postId) ?? null
}

/**
 * Guard for every mutating post route (PATCH, DELETE, restore). Returns the
 * active lock when it belongs to someone other than `userId` — the caller
 * turns that into a 409 — or `null` when the action may proceed (no lock,
 * a stale one, or the requester's own).
 */
export async function getBlockingLock(postId: string, userId: string): Promise<ActiveLock | null> {
  const lock = await getActiveLock(postId)
  if (!lock || lock.lockedBy.id === userId) return null
  return lock
}

export function lockConflictMessage(lock: ActiveLock): string {
  return `This post is currently being edited by ${lock.lockedBy.name || "another admin"}. Try again once they're done, or once their session has been idle a minute.`
}
