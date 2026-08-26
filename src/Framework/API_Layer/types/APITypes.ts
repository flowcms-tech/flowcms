import type { AxiosRequestConfig } from 'axios'

/**
 * Augment AxiosRequestConfig so that our custom BApiOptions properties
 * are accessible inside interceptors via `error.config` without unsafe casts.
 * InternalAxiosRequestConfig extends AxiosRequestConfig, so this propagates.
 */
declare module 'axios' {
  interface AxiosRequestConfig {
    showGlobalError?: boolean
    showGlobalLoader?: boolean
    showGlobalSuccess?: boolean
    errorCallback?: (error: Error) => void
    isPublicRequest?: boolean
    keepEmptyStrings?: boolean
    useCache?: boolean
    cacheTTL?: number
    cacheKey?: string
  }
}

/**
 * Options accepted by every BAPI method and useAPI hook.
 * Extends AxiosRequestConfig so all native axios config is valid.
 */
export interface BApiOptions extends AxiosRequestConfig {
  /** Show a global error toast on failure. Default: false */
  showGlobalError?: boolean
  /** Show a global loading indicator while the request is in flight. Default: false */
  showGlobalLoader?: boolean
  /** Show a global success toast on 2xx responses. Default: false */
  showGlobalSuccess?: boolean
  /**
   * Called with the error before it is thrown.
   * Runs regardless of showGlobalError — useful for side-effects like logging.
   */
  errorCallback?: (error: Error) => void
  /**
   * Reserved for future Laravel Sanctum auth.
   * When true the auth interceptor will skip attaching the Bearer token.
   * Currently does nothing.
   */
  isPublicRequest?: boolean
  /**
   * Keep empty-string values in non-GET bodies instead of stripping them.
   * Default: false.
   *
   * Needed by any form where clearing a text field is a legitimate action.
   * Without it `''` is dropped from the payload, so a PATCH route reads the
   * field as absent — "leave unchanged" — and the value can be set but never
   * blanked. See `sanitizePayload` in BAPI.ts for why the default is the way
   * it is.
   */
  keepEmptyStrings?: boolean

  // -- Cache (GET requests only) ----------------------------------------------
  /** Enable response caching for this GET request. Default: false */
  useCache?: boolean
  /** Cache time-to-live in milliseconds. Default: 1 800 000 (30 min) */
  cacheTTL?: number
  /**
   * Custom cache key. When omitted defaults to:
   * `GET:<url>:<JSON.stringify(params)>`
   */
  cacheKey?: string
}

/** Shape of a single entry stored in memory and localStorage. */
export interface CacheEntry<T = unknown> {
  data: T
  /** Unix timestamp (ms) after which this entry is considered expired. */
  expiry: number
}
