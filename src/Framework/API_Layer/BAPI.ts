import axiosInstance from './axios/axiosInstance'
import type { BApiOptions } from './types/APITypes'
import { getFromCache, saveToCache } from './cache/cacheStore'

const DEFAULT_TTL = 30 * 60 * 1_000 // 30 minutes in ms

const DEFAULT_OPTIONS: BApiOptions = {
  showGlobalSuccess: false,
  showGlobalError: false,
}

/**
 * Removes null / undefined / empty-string keys and trims string values.
 * Operates shallowly — nested objects are not recursed into.
 * Non-object payloads (arrays, primitives, null) are returned unchanged.
 *
 * `keepEmptyStrings` opts a single call out of the empty-string half of that.
 *
 * Why the escape hatch exists: dropping `''` makes "the user cleared this
 * field" indistinguishable from "the user didn't touch this field". On a PATCH
 * where absent means "leave unchanged" — which is every update route in this
 * app — that makes text fields **impossible to clear**. You could set a
 * canonical URL, a meta description, or a price range, and then never blank it
 * again from the UI; the request simply wouldn't carry the key.
 *
 * The default stays as-is because most callers rely on it to keep untouched
 * optional inputs out of the body, and flipping it globally would turn every
 * blank field on every form into an explicit overwrite. Callers that render a
 * form where clearing is a legitimate action pass `keepEmptyStrings: true`
 * and handle `''` on the server (the settings route already maps `'' → null`).
 */
function sanitizePayload(data: unknown, keepEmptyStrings = false): unknown {
  if (data === null || data === undefined) return data
  if (typeof FormData !== 'undefined' && data instanceof FormData) return data
  if (typeof data !== 'object' || Array.isArray(data)) return data

  return Object.fromEntries(
    Object.entries(data as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && (keepEmptyStrings || v !== ''))
      .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
  )
}

/**
 * GET — fetches data and optionally caches the response.
 *
 * Cache key priority: `options.cacheKey` → `GET:<url>:<serialized-params>`
 *
 * @example
 * const users = await BAPI.get<User[]>('/users', { useCache: true, cacheTTL: 60_000 })
 */
async function get<T>(url: string, options: BApiOptions = {}): Promise<T> {
  const { useCache, cacheTTL = DEFAULT_TTL, cacheKey, params, ...rest } = { ...DEFAULT_OPTIONS, ...options }

  if (useCache) {
    const key = cacheKey ?? `GET:${url}:${JSON.stringify(params ?? {})}`
    const cached = getFromCache<T>(key)
    if (cached !== null) return cached

    const { data } = await axiosInstance.get<T>(url, { params, ...rest })
    saveToCache(key, data, cacheTTL)
    return data
  }

  const { data } = await axiosInstance.get<T>(url, { params, ...rest })
  return data
}

/**
 * POST — sanitizes payload before sending.
 *
 * @example
 * const user = await BAPI.post<User>('/users', { name: 'John' })
 */
async function post<T>(url: string, body?: unknown, options: BApiOptions = {}): Promise<T> {
  const { data } = await axiosInstance.post<T>(url, sanitizePayload(body, options.keepEmptyStrings), { ...DEFAULT_OPTIONS, ...options })
  return data
}

/**
 * PUT — sanitizes payload before sending.
 *
 * @example
 * const result = await BAPI.put('/patients/1/soap/2/subjective', payload, {
 *   showGlobalSuccess: false,
 *   showGlobalError: false,
 * })
 */
async function put<T>(url: string, body: unknown, options: BApiOptions = {}): Promise<T> {
  const { data } = await axiosInstance.put<T>(url, sanitizePayload(body, options.keepEmptyStrings), { ...DEFAULT_OPTIONS, ...options })
  return data
}

/**
 * PATCH — sanitizes payload before sending.
 *
 * @example
 * const user = await BAPI.patch<User>('/users/1', { name: 'Jane' })
 */
async function patch<T>(url: string, body: unknown, options: BApiOptions = {}): Promise<T> {
  const { data } = await axiosInstance.patch<T>(url, sanitizePayload(body, options.keepEmptyStrings), { ...DEFAULT_OPTIONS, ...options })
  return data
}

/**
 * DELETE — body is optional.
 * Axios requires a DELETE body to be passed via `config.data`, which is
 * handled here automatically so callers don't need to think about it.
 *
 * @example
 * await BAPI.delete('/users/1')
 * await BAPI.delete('/users/1', { reason: 'duplicate' })
 */
async function del<T>(url: string, body?: unknown, options: BApiOptions = {}): Promise<T> {
  const { data } = await axiosInstance.delete<T>(url, {
    ...DEFAULT_OPTIONS,
    ...options,
    data: sanitizePayload(body, options.keepEmptyStrings),
  })
  return data
}

/**
 * Direct async API client. Use these methods when you don't need TanStack
 * Query (e.g. in event handlers, Server Actions, or utility functions).
 *
 * @example
 * import BAPI from '@/Framework/API_Layer'
 * const users = await BAPI.get<User[]>('/users')
 */
export const BAPI = {
  get,
  post,
  put,
  patch,
  delete: del,
} as const

export default BAPI
