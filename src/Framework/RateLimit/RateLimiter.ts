import { getRedisClient } from "../Redis/redisClient"

/**
 * Fixed-window rate limiter, used to put a ceiling on credential login attempts.
 *
 * WHY NOT CacheService
 *
 * `CacheService` is a cache: every operation fails soft to "no cache", which is
 * the right behaviour for a list endpoint and the wrong behaviour for a counter.
 * Its get-then-set shape is also a read-modify-write race, so two concurrent
 * attempts can both read the same count and both write count+1 — fine for
 * throttling spam volume on a public form, not fine when the thing being
 * counted is password guesses. This uses Redis `INCR`, which is atomic.
 *
 * BEHAVIOUR WHEN REDIS IS ABSENT OR DOWN
 *
 * Redis is optional in FlowCMS, so this falls back to a per-process in-memory
 * map. That is a real, deliberate trade-off, stated plainly:
 *
 *   - It still throttles. A single instance is protected.
 *   - It does NOT coordinate across replicas: with N app containers and no
 *     Redis, an attacker effectively gets N times the budget.
 *   - It resets on deploy or restart.
 *
 * The alternative — fail closed and refuse all logins when the limiter cannot
 * reach its backend — turns a Redis outage into a total lockout of the admin
 * panel, including the account needed to fix the outage. Degrading to a weaker
 * limit is the lesser harm. `.env.example` documents that a multi-replica
 * deployment should configure Redis.
 *
 * This module never throws. A limiter that can raise is a limiter that can take
 * authentication down with it.
 */

const PREFIX = "flowcms:ratelimit:"

interface MemoryEntry {
  count: number
  /** Epoch ms at which this window expires. */
  expiresAt: number
}

const memory = new Map<string, MemoryEntry>()

/** Test seam — resets the fallback store between cases. */
export function __resetInMemoryRateLimitStore(): void {
  memory.clear()
}

export interface RateLimitOptions {
  /** Caller-scoped identifier, e.g. `login:ip:1.2.3.4`. Namespaced internally. */
  key: string
  /** Attempts permitted per window. */
  limit: number
  windowSeconds: number
  /** Injectable clock, for deterministic tests. */
  now?: () => number
}

export interface RateLimitResult {
  limited: boolean
  /** Attempts used in the current window, including this one. */
  current: number
  /** Seconds until the window resets. 0 when not limited. */
  retryAfterSeconds: number
}

function pruneMemory(nowMs: number): void {
  // Bounded cleanup: the map only ever holds keys seen within a window, but an
  // instance under attack from many IPs should not grow it without limit.
  if (memory.size < 10_000) return
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= nowMs) memory.delete(key)
  }
}

function consumeInMemory(opts: Required<Pick<RateLimitOptions, "key" | "limit" | "windowSeconds">> & { nowMs: number }): RateLimitResult {
  const { key, limit, windowSeconds, nowMs } = opts
  pruneMemory(nowMs)

  const existing = memory.get(key)
  if (!existing || existing.expiresAt <= nowMs) {
    memory.set(key, { count: 1, expiresAt: nowMs + windowSeconds * 1000 })
    return { limited: 1 > limit, current: 1, retryAfterSeconds: 1 > limit ? windowSeconds : 0 }
  }

  existing.count += 1
  const limited = existing.count > limit
  return {
    limited,
    current: existing.count,
    retryAfterSeconds: limited ? Math.max(1, Math.ceil((existing.expiresAt - nowMs) / 1000)) : 0,
  }
}

/**
 * Records one attempt against `key` and reports whether the caller has now
 * exceeded `limit` within `windowSeconds`.
 *
 * Counts the current attempt, so `limit: 5` permits five and reports `limited`
 * on the sixth.
 */
export async function consumeRateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  const nowMs = (opts.now ?? Date.now)()
  const limit = Math.max(0, opts.limit)
  const windowSeconds = Math.max(1, opts.windowSeconds)
  const key = opts.key

  const redis = getRedisClient()
  if (redis) {
    try {
      const redisKey = `${PREFIX}${key}`
      const count = await redis.incr(redisKey)
      if (count === 1) {
        // Only the attempt that created the window sets its expiry, so a burst
        // cannot keep pushing the reset time out (which would turn a fixed
        // window into an unbounded lockout).
        await redis.expire(redisKey, windowSeconds)
      }
      const limited = count > limit
      let retryAfterSeconds = 0
      if (limited) {
        const ttl = await redis.ttl(redisKey)
        retryAfterSeconds = ttl > 0 ? ttl : windowSeconds
      }
      return { limited, current: count, retryAfterSeconds }
    } catch {
      // Redis unreachable mid-request — fall through to the in-memory limiter
      // rather than failing the login attempt outright.
    }
  }

  return consumeInMemory({ key, limit, windowSeconds, nowMs })
}

/**
 * Clears a counter. Called on a successful login so that a user who mistyped
 * their password twice is not still carrying those attempts an hour later.
 */
export async function resetRateLimit(key: string): Promise<void> {
  memory.delete(key)
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.del(`${PREFIX}${key}`)
  } catch {
    // Nothing to do: the window expires on its own.
  }
}
