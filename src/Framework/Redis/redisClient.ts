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
 *
 * ONE CLIENT PER PROCESS, NOT ONE PER EVALUATION. `next dev` re-evaluates this
 * module after a save without restarting Node, and a module-scope `let` came
 * back null every time: the next call opened another connection and the old
 * one stayed open with nothing left to close it — the leak issue #18 found in
 * the database handle. The client lives on `globalThis`, which survives
 * re-evaluation, and is reused while REDIS_URL is unchanged. A changed or
 * removed REDIS_URL (Next reloads `.env` in place) disconnects the old client.
 */

const SHARED_CLIENT = Symbol.for("flowcms.redis.client")

type SharedClient = { url: string; client: Redis }

const shared = globalThis as typeof globalThis & { [SHARED_CLIENT]?: SharedClient }

export function getRedisClient(): Redis | null {
  const url = process.env.REDIS_URL
  const existing = shared[SHARED_CLIENT]

  if (existing && existing.url === url) return existing.client

  if (existing) {
    existing.client.disconnect()
    delete shared[SHARED_CLIENT]
  }

  if (!url) return null

  const client = new Redis(url, {
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

  shared[SHARED_CLIENT] = { url, client }
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
