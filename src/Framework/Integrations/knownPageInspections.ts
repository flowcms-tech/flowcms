import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPosts } from "@/db/tables"
import { getBaseUrl, getGscConfig, getGscRedirectUri } from "@/Framework/Settings/SettingsService"
import { inspectUrl, type GscUrlInspection } from "@/Framework/Integrations/GoogleSearchConsole"
import { CacheService } from "@/Framework/Redis/CacheService"

/**
 * Resolves this site's known published-post URLs and inspects each one via
 * the URL Inspection API, cache-aside with a concurrency cap — the exact
 * logic Page Indexing and Enhancements both need (one inspection call
 * returns everything both screens read: index status for one, rich-results
 * detail for the other). Extracted here so a single inspection per URl is
 * shared rather than each screen re-inspecting the same pages.
 */

/** Inspection results don't change minute to minute — a day is a
 *  reasonable balance between staying current and not burning the
 *  property's URL Inspection quota (2,000/day by default) on repeats. */
export const INSPECTION_CACHE_TTL_SECONDS = 24 * 60 * 60

/** Safety cap, not a real limit for this site's post count — protects the
 *  quota (and the request's own wall-clock time) if the blog ever grows
 *  large enough for this to matter. */
export const MAX_INSPECTED_PAGES = 100

/** How many URL Inspection calls run at once. Google doesn't publish a
 *  hard per-second limit for this API, but every call is a real network
 *  round trip to Google — a handful in flight keeps the whole batch fast
 *  without looking like abuse. */
const CONCURRENCY = 5

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** Just the URL-listing half, with no Search Console dependency — shared
 *  with Core Web Vitals, which calls a different API (PageSpeed Insights)
 *  against the same set of known pages. */
export async function getKnownPublishedPostUrls(): Promise<{ urls: string[]; totalKnownPages: number }> {
  const [baseUrl, posts] = await Promise.all([
    getBaseUrl(),
    db.query.blogPosts.findMany({
      where: and(eq(blogPosts.isPublished, true), isNull(blogPosts.deletedAt)),
      columns: { slug: true },
    }),
  ])

  const allUrls = posts.map((post) => `${baseUrl}/blog/${post.slug}`)
  return { urls: allUrls.slice(0, MAX_INSPECTED_PAGES), totalKnownPages: allUrls.length }
}

/** Adds `id`/`title` to the URL list above — the Action Feed and Page
 *  Profile both need to resolve a Search Console URL back to a post id
 *  (for role-scoping and for "view profile" links), which the plain URL
 *  list has no way to do. Not capped at MAX_INSPECTED_PAGES: this is a
 *  cheap DB read, not a quota-metered Google call. */
export async function getKnownPublishedPostsMeta(): Promise<{ id: string; slug: string; title: string; url: string; authorId: string }[]> {
  const [baseUrl, posts] = await Promise.all([
    getBaseUrl(),
    db.query.blogPosts.findMany({
      where: and(eq(blogPosts.isPublished, true), isNull(blogPosts.deletedAt)),
      columns: { id: true, slug: true, title: true, authorId: true },
    }),
  ])

  return posts.map((post) => ({ id: post.id, slug: post.slug, title: post.title, url: `${baseUrl}/blog/${post.slug}`, authorId: post.authorId }))
}

export type KnownPageInspectionsResult =
  | { status: "not_connected"; reason: string; siteUrl: "" }
  | { status: "no_pages"; reason: string; siteUrl: string }
  | {
      status: "ok"
      siteUrl: string
      /** Inspection result per URL, in the same order as `urls` — a failed
       *  inspection is a thrown error the caller catches per-item, not a
       *  missing entry, so callers should wrap each `fn` call themselves. */
      urls: string[]
      totalKnownPages: number
      getInspection: (url: string) => Promise<GscUrlInspection>
    }

/**
 * Resolves the connection + known published-post URLs (capped at
 * MAX_INSPECTED_PAGES) and returns a ready-to-use `getInspection` closure
 * that caches each URL's result for INSPECTION_CACHE_TTL_SECONDS. Callers
 * still choose their own concurrency/aggregation — this only removes the
 * duplicated connection-resolution and cache-aside plumbing.
 */
export async function getKnownPageInspections(options: {
  forceRefresh?: boolean
}): Promise<KnownPageInspectionsResult> {
  const gsc = await getGscConfig()

  if (!gsc.clientId || !gsc.clientSecret || !gsc.refreshToken) {
    return {
      status: "not_connected",
      reason: "Search Console is not connected. Connect it under Settings → Integrations.",
      siteUrl: "",
    }
  }
  if (!gsc.siteUrl) {
    return {
      status: "not_connected",
      reason: "Search Console is connected but no property is selected. Pick one under Settings → Integrations.",
      siteUrl: "",
    }
  }

  const siteUrl = gsc.siteUrl
  const refreshToken = gsc.refreshToken

  const { urls, totalKnownPages } = await getKnownPublishedPostUrls()

  if (totalKnownPages === 0) {
    return { status: "no_pages", reason: "No published posts yet — there's nothing to inspect.", siteUrl }
  }

  const redirectUri = await getGscRedirectUri()
  const credentials = { clientId: gsc.clientId, clientSecret: gsc.clientSecret, redirectUri }

  const forceRefresh = options.forceRefresh ?? false

  async function getInspection(url: string): Promise<GscUrlInspection> {
    const cacheKey = `gsc:url-inspection:${siteUrl}:${url}`
    if (forceRefresh) {
      const fresh = await inspectUrl(credentials, refreshToken, siteUrl, url)
      await CacheService.setJson(cacheKey, fresh, INSPECTION_CACHE_TTL_SECONDS)
      return fresh
    }
    return CacheService.remember(cacheKey, INSPECTION_CACHE_TTL_SECONDS, () =>
      inspectUrl(credentials, refreshToken, siteUrl, url)
    )
  }

  return { status: "ok", siteUrl, urls, totalKnownPages, getInspection }
}

/** Looks up (or freshly runs, cached) a single URL's inspection — used by
 *  Page Profile, which needs one specific page rather than the whole known-
 *  pages batch. Shares the exact cache key format `getKnownPageInspections`
 *  uses, so a URL already inspected via Page Indexing/Enhancements is a
 *  cache hit here too, not a duplicate Google call. */
export async function getInspectionForUrl(url: string): Promise<{ status: "not_connected"; reason: string } | { status: "ok"; inspection: GscUrlInspection }> {
  const gsc = await getGscConfig()
  if (!gsc.clientId || !gsc.clientSecret || !gsc.refreshToken) {
    return { status: "not_connected", reason: "Search Console is not connected. Connect it under Settings → Integrations." }
  }
  if (!gsc.siteUrl) {
    return { status: "not_connected", reason: "Search Console is connected but no property is selected. Pick one under Settings → Integrations." }
  }

  const siteUrl = gsc.siteUrl
  const redirectUri = await getGscRedirectUri()
  const credentials = { clientId: gsc.clientId, clientSecret: gsc.clientSecret, redirectUri }
  const cacheKey = `gsc:url-inspection:${siteUrl}:${url}`

  const inspection = await CacheService.remember(cacheKey, INSPECTION_CACHE_TTL_SECONDS, () =>
    inspectUrl(credentials, gsc.refreshToken!, siteUrl, url)
  )
  return { status: "ok", inspection }
}

export { CONCURRENCY as INSPECTION_CONCURRENCY }
