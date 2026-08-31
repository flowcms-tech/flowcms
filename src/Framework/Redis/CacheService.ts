import { getRedisClient } from "./redisClient"

/**
 * Every app-owned cache key lives under this prefix. Nothing here ever
 * touches a key without it — SCAN, DEL-by-pattern, and the "flush" button in
 * the admin panel all stay scoped to it, so this app can share a Redis
 * instance with something else on the same box without ever being able to
 * see or wipe that other thing's keys.
 */
export const CACHE_PREFIX = "flowcms:cache:"

/**
 * Shared TTL for every admin list/detail cache entry. Deliberately
 * short and deliberately the same everywhere, not tuned per entity: the
 * thing that actually keeps data correct is every write calling
 * `delPattern` on its own entity, not this number — this is just the
 * self-healing backstop for the rare case an invalidation call is missed.
 *
 * It used to also have to stay well under the 1-hour presigned-URL TTL,
 * because several responses cached here embedded a presigned image URL that
 * expired independently of the cache entry — so an entry that outlived its own
 * embedded URL started serving broken images. Phase 2 removed presigning
 * entirely and cached payloads now carry stable `/api/media` paths, so that
 * constraint is gone. 60s is kept for the invalidation-backstop reason above,
 * which was always the real one.
 */
export const ADMIN_CACHE_TTL_SECONDS = 60

function prefixed(key: string): string {
  return key.startsWith(CACHE_PREFIX) ? key : `${CACHE_PREFIX}${key}`
}

/**
 * Cache-aside helpers used across the admin API routes (see
 * src/Modules/Redis/README-equivalent comment in RedisModule.tsx for the
 * full list of call sites). Every function fails soft: a Redis outage
 * degrades every caller back to hitting the database directly rather than
 * ever surfacing as a 500. This module never becomes a hard dependency.
 */
export const CacheService = {
  async getJson<T>(key: string): Promise<T | null> {
    const redis = getRedisClient()
    if (!redis) return null
    try {
      const raw = await redis.get(prefixed(key))
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  },

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const redis = getRedisClient()
    if (!redis) return
    try {
      await redis.set(prefixed(key), JSON.stringify(value), "EX", ttlSeconds)
    } catch {
      // A failed write just means the next read misses and falls back to
      // the database — never worth surfacing to the caller.
    }
  },

  /**
   * Cache-aside in one call: serve a hit, otherwise compute, store, and
   * return. This is the one every route actually calls — `getJson`/`setJson`
   * exist mainly so this can be built out of them.
   */
  async remember<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
    const cached = await CacheService.getJson<T>(key)
    if (cached !== null) return cached

    const fresh = await compute()
    await CacheService.setJson(key, fresh, ttlSeconds)
    return fresh
  },

  async del(key: string): Promise<void> {
    const redis = getRedisClient()
    if (!redis) return
    try {
      await redis.del(prefixed(key))
    } catch {
      // Nothing to fall back to here — worst case is a stale entry that
      // expires on its own via its TTL.
    }
  },

  /**
   * Deletes every key matching a pattern *within our own prefix* — the
   * pattern is always resolved relative to CACHE_PREFIX, so callers write
   * `delPattern("blog-posts:*")`, never a bare `"*"` that could reach outside
   * it. Used for invalidation: any write to an entity clears every cached
   * shape of it (list pages, filtered variants, the detail key) in one call
   * rather than tracking each cache key individually.
   *
   * SCAN, not KEYS — KEYS blocks the whole Redis event loop while it walks
   * the keyspace; SCAN walks it incrementally and never blocks, the
   * documented best practice for anything past toy scale.
   */
  async delPattern(pattern: string): Promise<number> {
    const redis = getRedisClient()
    if (!redis) return 0
    try {
      let cursor = "0"
      let deleted = 0
      const fullPattern = prefixed(pattern)
      do {
        const [nextCursor, keys] = await redis.scan(cursor, "MATCH", fullPattern, "COUNT", 200)
        cursor = nextCursor
        if (keys.length > 0) {
          deleted += await redis.del(...keys)
        }
      } while (cursor !== "0")
      return deleted
    } catch {
      return 0
    }
  },
}
