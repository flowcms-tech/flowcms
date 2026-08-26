import type { CacheEntry } from '../types/APITypes'

const CACHE_PREFIX = 'BAPI_CACHE:'

/** In-memory store — fastest path; lives for the browser session. */
const memoryCache = new Map<string, CacheEntry>()

/**
 * Read a cached value.
 * Checks in-memory first; falls back to localStorage on a miss.
 * Returns `null` when the entry is absent or expired.
 */
export function getFromCache<T>(key: string): T | null {
  const mem = memoryCache.get(key)
  if (mem) {
    if (Date.now() < mem.expiry) return mem.data as T
    memoryCache.delete(key)
  }

  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    if (raw) {
      const entry = JSON.parse(raw) as CacheEntry<T>
      if (Date.now() < entry.expiry) {
        // Restore to memory so the next read is instant.
        memoryCache.set(key, entry as CacheEntry)
        return entry.data
      }
      localStorage.removeItem(CACHE_PREFIX + key)
    }
  } catch {
    // localStorage is unavailable (SSR, private browsing, quota exceeded).
    // In-memory cache still works normally.
  }

  return null
}

/**
 * Persist a value in both the in-memory cache and localStorage.
 * @param key  Unique cache key.
 * @param data The value to cache.
 * @param ttl  Time-to-live in milliseconds.
 */
export function saveToCache<T>(key: string, data: T, ttl: number): void {
  const entry: CacheEntry<T> = { data, expiry: Date.now() + ttl }
  memoryCache.set(key, entry as CacheEntry)

  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry))
  } catch {
    // Quota exceeded or unavailable — in-memory cache still works.
  }
}

/** Remove a single entry from both the memory cache and localStorage. */
export function clearCache(key: string): void {
  memoryCache.delete(key)
  try {
    localStorage.removeItem(CACHE_PREFIX + key)
  } catch {
    // ignore
  }
}

/** Remove every BAPI cache entry from both the memory cache and localStorage. */
export function clearAll(): void {
  memoryCache.clear()

  try {
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(CACHE_PREFIX)) toRemove.push(k)
    }
    toRemove.forEach((k) => localStorage.removeItem(k))
  } catch {
    // ignore
  }
}

/**
 * Public helper — clears every BAPI cache entry from memory and localStorage.
 * Prefer this over calling `clearAll()` directly from application code.
 *
 * @example
 * import { clearBAPICache } from '@/Framework/API_Layer'
 * clearBAPICache()
 */
export function clearBAPICache(): void {
  clearAll()
}
