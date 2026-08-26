import Redis from "ioredis"

/**
 * Lazy singleton, mirroring src/db/client.ts's shape — one connection per
 * server process, created on first use rather than at import time.
 *
 * Unlike the SQLite client, this one has to tolerate Redis simply not being
 * there: an admin panel's caching layer is an optimization, not a dependency
 * anything correctness-critical relies on, and `getBlockingLock`/the trash
 * guard/every other real invariant in this app is enforced in SQLite, never
 * in the cache. So every setting below is chosen to fail fast and quiet
 * rather than retry forever or throw past the caller — see CacheService.ts,
 * which wraps every command in a try/catch for exactly this reason.
 */

let client: Redis | null = null

export function getRedisClient(): Redis | null {
  const url = process.env.REDIS_URL
  if (!url) return null

  if (!client) {
    client = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 2000,
      // Don't queue commands while disconnected — fail the individual call
      // immediately so a caller's try/catch can fall back to the database
      // instead of hanging behind a queue that may never flush.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy(attempt) {
        return Math.min(attempt * 500, 5000)
      },
    })

    // ioredis treats an unhandled 'error' listener as a fatal, process-crashing
    // exception. This one exists purely to prevent that — connection failures
    // are surfaced through CacheService's return values (null / false), not
    // through this handler.
    client.on("error", () => {})
  }

  return client
}

/** True once a command has actually round-tripped successfully — distinct
 *  from "a client object exists," which is true even while fully offline. */
export async function isRedisReachable(): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false
  try {
    const pong = await redis.ping()
    return pong === "PONG"
  } catch {
    return false
  }
}
