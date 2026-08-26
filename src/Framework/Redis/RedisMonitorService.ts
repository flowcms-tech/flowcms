import { getRedisClient, isRedisReachable } from "./redisClient"
import { CacheService, CACHE_PREFIX } from "./CacheService"

/**
 * Read/inspect operations for the admin panel's Redis screen — separate from
 * CacheService, which is what the rest of the app calls to actually cache
 * things. This file exists to answer "is it up, what's in it, how healthy
 * is it," not to be a cache API.
 */

export interface RedisStatus {
  connected: boolean
  latencyMs: number | null
  dbSize: number | null
  usedMemoryHuman: string | null
  uptimeSeconds: number | null
  connectedClients: number | null
  keyspaceHits: number | null
  keyspaceMisses: number | null
  hitRatePercent: number | null
  appKeyCount: number | null
}

function parseInfo(raw: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of raw.split("\r\n")) {
    if (!line || line.startsWith("#")) continue
    const separatorIndex = line.indexOf(":")
    if (separatorIndex === -1) continue
    fields[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1)
  }
  return fields
}

export async function getStatus(): Promise<RedisStatus> {
  const redis = getRedisClient()
  const empty: RedisStatus = {
    connected: false,
    latencyMs: null,
    dbSize: null,
    usedMemoryHuman: null,
    uptimeSeconds: null,
    connectedClients: null,
    keyspaceHits: null,
    keyspaceMisses: null,
    hitRatePercent: null,
    appKeyCount: null,
  }
  if (!redis) return empty

  try {
    const start = Date.now()
    const reachable = await isRedisReachable()
    const latencyMs = Date.now() - start
    if (!reachable) return empty

    const [infoRaw, dbSize, appKeyCount] = await Promise.all([
      redis.info(),
      redis.dbsize(),
      countAppKeys(),
    ])
    const info = parseInfo(infoRaw)

    const hits = Number(info.keyspace_hits ?? 0)
    const misses = Number(info.keyspace_misses ?? 0)
    const total = hits + misses

    return {
      connected: true,
      latencyMs,
      dbSize,
      usedMemoryHuman: info.used_memory_human ?? null,
      uptimeSeconds: info.uptime_in_seconds ? Number(info.uptime_in_seconds) : null,
      connectedClients: info.connected_clients ? Number(info.connected_clients) : null,
      keyspaceHits: hits,
      keyspaceMisses: misses,
      hitRatePercent: total > 0 ? Math.round((hits / total) * 1000) / 10 : null,
      appKeyCount,
    }
  } catch {
    return empty
  }
}

async function countAppKeys(): Promise<number> {
  const redis = getRedisClient()
  if (!redis) return 0
  let cursor = "0"
  let count = 0
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", `${CACHE_PREFIX}*`, "COUNT", 500)
    cursor = next
    count += keys.length
  } while (cursor !== "0")
  return count
}

export interface KeySummary {
  key: string
  type: string
  ttlSeconds: number | null
}

export interface ScanPage {
  keys: KeySummary[]
  nextCursor: string
  done: boolean
}

/**
 * One page of this app's own keyspace, browsable by pattern.
 *
 * SCOPED TO CACHE_PREFIX, and that is a change from how this started.
 *
 * It used to scan the whole instance, on the reasoning that a read-only
 * monitoring view of "the redis service" was a different thing from a mutating
 * action, and only mutations needed scoping. That reasoning does not survive
 * the shared-instance case, which is the normal case: Redis is routinely shared
 * between applications on one box, and key NAMES are not neutral — they carry
 * another application's schema, its session identifiers, its queue names, and
 * often a user id or email in the key itself. Combined with the value read on
 * `/api/redis/key`, this made the CMS a general-purpose browser for a
 * neighbouring app's data.
 *
 * The caller's `pattern` is applied WITHIN the prefix rather than replacing it,
 * so `blog-posts:*` still works and `*` means "everything of ours" instead of
 * "everything".
 */
export async function scanKeyspace(pattern: string, cursor: string, count = 50): Promise<ScanPage> {
  const redis = getRedisClient()
  if (!redis) return { keys: [], nextCursor: "0", done: true }

  const requested = pattern || "*"
  const scoped = requested.startsWith(CACHE_PREFIX)
    ? requested
    : `${CACHE_PREFIX}${requested}`

  const [nextCursor, rawKeys] = await redis.scan(cursor, "MATCH", scoped, "COUNT", count)

  const keys = await Promise.all(
    rawKeys.map(async (key): Promise<KeySummary> => {
      const [type, ttl] = await Promise.all([redis.type(key), redis.ttl(key)])
      return { key, type, ttlSeconds: ttl >= 0 ? ttl : null }
    })
  )

  return { keys, nextCursor, done: nextCursor === "0" }
}

export interface KeyDetail {
  key: string
  type: string
  ttlSeconds: number | null
  approxBytes: number | null
  value: unknown
}

/** Fetches a key's full value, shaped by its Redis type — this is the
 *  "structure of data" view: a hash renders as an object, a list/set as an
 *  array, a string is JSON-parsed when it looks like one of ours (every app
 *  cache value is JSON) and returned raw otherwise. */
export async function getKeyDetail(key: string): Promise<KeyDetail | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const type = await redis.type(key)
  if (type === "none") return null

  const [ttl, approxBytes] = await Promise.all([
    redis.ttl(key),
    redis.memory("USAGE", key).catch(() => null),
  ])

  let value: unknown = null
  switch (type) {
    case "string": {
      const raw = await redis.get(key)
      try {
        value = raw !== null ? JSON.parse(raw) : null
      } catch {
        value = raw
      }
      break
    }
    case "hash":
      value = await redis.hgetall(key)
      break
    case "list":
      value = await redis.lrange(key, 0, 200)
      break
    case "set":
      value = await redis.smembers(key)
      break
    case "zset":
      value = await redis.zrange(key, 0, "200", "WITHSCORES")
      break
    default:
      value = null
  }

  return {
    key,
    type,
    ttlSeconds: ttl >= 0 ? ttl : null,
    approxBytes: typeof approxBytes === "number" ? approxBytes : null,
    value,
  }
}

/** Refuses anything outside our own prefix — an admin of this app's panel is
 *  not necessarily an admin of whatever else might share this Redis
 *  instance, so a single-key delete can only ever remove a key we wrote. */
export async function deleteAppKey(key: string): Promise<boolean> {
  if (!key.startsWith(CACHE_PREFIX)) return false
  const redis = getRedisClient()
  if (!redis) return false
  const removed = await redis.del(key)
  return removed > 0
}

/** Clears every key this app owns. Never FLUSHALL/FLUSHDB — those would
 *  take out anything else sharing the instance, which this app has no way
 *  to know about or recover. */
export async function flushAppCache(): Promise<number> {
  return CacheService.delPattern("*")
}
