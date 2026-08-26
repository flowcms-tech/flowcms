import "server-only"

import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { authors, blogCategories, blogPosts, blogTags, redirects } from "@/db/tables"
import { CacheService } from "@/Framework/Redis/CacheService"
import { getBaseUrl } from "@/Framework/Settings/SettingsService"
import { extractLinks } from "@/Modules/Blog/Posts/Values/contentStats"
import { toInternalPath } from "@/Modules/Blog/Posts/Values/internalUrls"
import { BlockedUrlError, MAX_REDIRECTS, safeFetch } from "@/Framework/Net/ssrfGuard"

/**
 * Broken-link scanning over post content.
 *
 * Two rules shape everything below.
 *
 * **Internal links never make an HTTP request.** A post's own site is fully
 * described by the database, so `/blog/some-slug` is a `Set.has`, not a
 * round-trip. Scanning a hundred posts would otherwise mean the app DDoSing
 * itself, and on a cold serverless start it would deadlock waiting on a request
 * it is itself supposed to serve.
 *
 * **A doubtful external link is `unverifiable`, never `broken`.** Cloudflare,
 * LinkedIn (999), and most news sites answer automated requests with 403 or a
 * challenge page. A checker that calls those "broken" is wrong on a third of
 * its output, gets ignored within a week, and is then worse than no checker at
 * all — because the two genuinely dead links are now buried in a list nobody
 * reads. Only an explicit 404/410 or a hostname that does not resolve is called
 * broken here.
 *
 * Triggered by hand only. There is no cron in this app, and bolting background
 * work onto whichever visitor happens to load a page is a pattern this codebase
 * has already decided against.
 */

export type LinkCheckOutcome = "ok" | "broken" | "redirect" | "timeout" | "unverifiable"

export interface CheckedLink {
  url: string
  isInternal: boolean
  statusCode: number | null
  result: LinkCheckOutcome
  /** Why it landed in that bucket, in the words the UI shows. */
  note: string
  /** The anchor text, so an editor can find the link in the body. */
  text: string
}

export interface PostLinkScanInput {
  postId: string
  content: string
}

export interface PostLinkScanResult {
  postId: string
  links: CheckedLink[]
}

/** Long enough for a slow origin, short enough that a scan of 100 posts with a
 *  handful of dead hosts still finishes while someone is watching. */
const TIMEOUT_MS = 5000

/** Five at a time, across the whole scan rather than per post — a 40-post batch
 *  must not become 40 × 5 concurrent sockets. */
const CONCURRENCY = 5

/** External results are cached for a week: a rescan the next day should not
 *  re-hammer every host a post cites, and a link that resolved yesterday has
 *  not become interesting today. */
const RESULT_TTL_SECONDS = 7 * 24 * 60 * 60

/** Descriptive on purpose. An operator reading their access log should be able
 *  to tell what hit them and why, rather than seeing a bare fetch agent. */
function userAgent(baseUrl: string): string {
  return `Mozilla/5.0 (compatible; FlowCMSLinkCheck/1.0; +${baseUrl}) admin link verification`
}

/** Statuses that mean "we were not allowed to ask", not "this page is gone".
 *  429 and 999 in particular are pure bot-protection. */
const BLOCKED_STATUSES = new Set([401, 403, 405, 406, 407, 418, 429, 451, 999])

/** Only these two are proof. Every other 4xx could be the checker's fault. */
const DEAD_STATUSES = new Set([404, 410])

interface CachedResult {
  statusCode: number | null
  result: LinkCheckOutcome
  note: string
}

// -- Internal resolution -----------------------------------------------------

interface InternalIndex {
  publishedPostSlugs: Set<string>
  /** Slugs that exist but are unpublished or trashed — a real broken link for a
   *  reader, and a much more useful message than "not found". */
  hiddenPostSlugs: Set<string>
  categorySlugs: Set<string>
  tagSlugs: Set<string>
  authorSlugs: Set<string>
  redirectPaths: Set<string>
}

/** Static public paths that are routes rather than database rows. Kept
 *  deliberately short — see `resolveInternal` for why an unrecognised path is
 *  not called broken. */
const KNOWN_STATIC_PATHS = new Set(["/", "/blog", "/blog/rss.xml"])

export async function loadInternalIndex(): Promise<InternalIndex> {
  const [postRows, categoryRows, tagRows, authorRows, redirectRows] = await Promise.all([
    db
      .select({
        slug: blogPosts.slug,
        isPublished: blogPosts.isPublished,
        deletedAt: blogPosts.deletedAt,
      })
      .from(blogPosts),
    db.select({ slug: blogCategories.slug, isActive: blogCategories.isActive }).from(blogCategories),
    db.select({ slug: blogTags.slug, isActive: blogTags.isActive }).from(blogTags),
    db.select({ slug: authors.slug, isActive: authors.isActive }).from(authors),
    db.select({ fromPath: redirects.fromPath }).from(redirects),
  ])

  const publishedPostSlugs = new Set<string>()
  const hiddenPostSlugs = new Set<string>()
  for (const row of postRows) {
    if (row.isPublished && !row.deletedAt) publishedPostSlugs.add(row.slug.toLowerCase())
    else hiddenPostSlugs.add(row.slug.toLowerCase())
  }

  return {
    publishedPostSlugs,
    hiddenPostSlugs,
    categorySlugs: new Set(categoryRows.filter((r) => r.isActive).map((r) => r.slug.toLowerCase())),
    tagSlugs: new Set(tagRows.filter((r) => r.isActive).map((r) => r.slug.toLowerCase())),
    authorSlugs: new Set(authorRows.filter((r) => r.isActive).map((r) => r.slug.toLowerCase())),
    redirectPaths: new Set(redirectRows.map((r) => r.fromPath.toLowerCase())),
  }
}

function resolveInternal(path: string, index: InternalIndex): Omit<CheckedLink, "url" | "text"> {
  const lower = path.toLowerCase()
  const base = { isInternal: true, statusCode: null }

  if (KNOWN_STATIC_PATHS.has(lower)) {
    return { ...base, result: "ok", note: "Site route." }
  }

  const segments = lower.split("/").filter(Boolean)

  if (segments[0] === "blog" && segments.length >= 2) {
    const archive = segments[1]
    const slug = segments[2]

    if (archive === "category" || archive === "tag" || archive === "author") {
      const set =
        archive === "category" ? index.categorySlugs : archive === "tag" ? index.tagSlugs : index.authorSlugs
      if (slug && set.has(slug)) {
        return { ...base, result: "ok", note: `Resolves to an active ${archive} archive.` }
      }
      if (index.redirectPaths.has(lower)) {
        return { ...base, result: "redirect", note: "No longer exists, but a redirect covers it." }
      }
      return { ...base, result: "broken", note: `No active ${archive} with that slug.` }
    }

    if (segments.length === 2) {
      if (index.publishedPostSlugs.has(archive)) {
        return { ...base, result: "ok", note: "Resolves to a published post." }
      }
      if (index.redirectPaths.has(lower)) {
        return { ...base, result: "redirect", note: "Slug changed, but a redirect covers it." }
      }
      if (index.hiddenPostSlugs.has(archive)) {
        return {
          ...base,
          result: "broken",
          // Worth its own message: the fix is to publish or restore the target,
          // not to change the link.
          note: "That post exists but is unpublished or in the trash, so readers get a 404.",
        }
      }
      return { ...base, result: "broken", note: "No post with that slug." }
    }
  }

  if (index.redirectPaths.has(lower)) {
    return { ...base, result: "redirect", note: "Covered by a redirect." }
  }

  // Deliberately not "broken". Only blog URLs are enumerable from the database;
  // marketing routes are files on disk and this checker cannot see them without
  // making the HTTP request it exists to avoid. Guessing "broken" here would be
  // the exact false alarm that gets the whole report ignored.
  return {
    ...base,
    result: "unverifiable",
    note: "Not a blog URL — this checker only resolves blog paths against the database.",
  }
}

// -- External checking -------------------------------------------------------

function classify(status: number, redirected: boolean): Omit<CachedResult, "statusCode"> {
  if (status >= 200 && status < 300) {
    return redirected
      ? { result: "redirect", note: "Reachable, but the URL redirects. Point the link at the final destination." }
      : { result: "ok", note: `HTTP ${status}.` }
  }
  if (status >= 300 && status < 400) {
    return { result: "redirect", note: `HTTP ${status} — the URL redirects.` }
  }
  if (DEAD_STATUSES.has(status)) {
    return { result: "broken", note: `HTTP ${status} — the page is gone.` }
  }
  if (BLOCKED_STATUSES.has(status)) {
    return {
      result: "unverifiable",
      note: `HTTP ${status} — the site blocks automated requests. Open it yourself before changing anything.`,
    }
  }
  if (status >= 500) {
    return { result: "unverifiable", note: `HTTP ${status} — the server errored. Usually temporary.` }
  }
  return { result: "unverifiable", note: `HTTP ${status} — could not be confirmed either way.` }
}

/**
 * One request, through the SSRF guard.
 *
 * This used to call `fetch` directly with `redirect: "follow"`, which is the
 * shape that made the checker a blind internal port scanner: any URL an author
 * could put in a draft, this server would request, and the resulting status
 * code came back in the results table. `safeFetch` validates the destination
 * before every hop, so a public host that 302s to `http://169.254.169.254/` is
 * refused at the second hop rather than fetched — following redirects
 * internally would have hidden that hop from the guard entirely.
 */
async function requestOnce(
  url: string,
  method: "HEAD" | "GET",
  agent: string
): Promise<{ response: Response; redirected: boolean }> {
  const { response, redirected } = await safeFetch(url, {
    method,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      "User-Agent": agent,
      Accept: "*/*",
      // A one-byte range on the GET fallback: enough to get a status line
      // without downloading a 4 MB page just to learn it exists.
      ...(method === "GET" ? { Range: "bytes=0-0" } : {}),
    },
  })
  return { response, redirected }
}

async function checkExternal(url: string, agent: string): Promise<CachedResult> {
  const cacheKey = `link-check:url:${url}`
  const cached = await CacheService.getJson<CachedResult>(cacheKey)
  if (cached) return cached

  let outcome: CachedResult
  try {
    let attempt = await requestOnce(url, "HEAD", agent)

    // Plenty of servers answer HEAD with 405/403/501 while serving GET fine.
    // Treating those as failures would mislabel a large share of good links.
    const { status } = attempt.response
    if (!attempt.response.ok && (status === 403 || status === 405 || status === 501)) {
      try {
        attempt = await requestOnce(url, "GET", agent)
      } catch {
        // Keep the HEAD result — a failed fallback tells us nothing new.
      }
    }

    outcome = {
      statusCode: attempt.response.status,
      ...classify(attempt.response.status, attempt.redirected),
    }
  } catch (error) {
    // A destination the guard refused is "unverifiable", never "broken": the
    // link may be perfectly reachable for a reader on the public internet.
    // What it is not, is something this server will fetch on their behalf.
    // Handled first so the specific reason survives the generic branches below.
    if (error instanceof BlockedUrlError) {
      const blocked: CachedResult = {
        statusCode: null,
        result: "unverifiable",
        note:
          `Not checked: ${error.message} ` +
          `(at most ${MAX_REDIRECTS} redirects are followed, and every hop is re-checked).`,
      }
      await CacheService.setJson(cacheKey, blocked, RESULT_TTL_SECONDS)
      return blocked
    }

    const name = error instanceof Error ? error.name : ""
    const code =
      error && typeof error === "object" && "cause" in error && error.cause && typeof error.cause === "object" && "code" in error.cause
        ? String((error.cause as { code: unknown }).code)
        : ""

    if (name === "TimeoutError" || name === "AbortError") {
      outcome = {
        statusCode: null,
        result: "timeout",
        note: `No response within ${TIMEOUT_MS / 1000}s. Slow hosts and bot protection both look like this.`,
      }
    } else if (code === "ENOTFOUND") {
      // The one network failure that is genuinely proof: the hostname does not
      // exist in DNS, so no reader will ever reach it either.
      outcome = { statusCode: null, result: "broken", note: "The domain does not resolve." }
    } else {
      outcome = {
        statusCode: null,
        result: "unverifiable",
        note: `Could not connect${code ? ` (${code})` : ""}. May be the host, may be this server's network.`,
      }
    }
  }

  await CacheService.setJson(cacheKey, outcome, RESULT_TTL_SECONDS)
  return outcome
}

/** Fixed-size worker pool. `Promise.all` over every URL at once would open one
 *  socket per link in the batch; a semaphore library for this would be a
 *  dependency for twelve lines. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

// -- Entry point -------------------------------------------------------------

/**
 * Scans one or many posts. External URLs are deduplicated across the whole
 * batch before any request goes out, so ten posts citing the same standard
 * cost one round-trip rather than ten.
 */
export async function scanPostLinks(posts: PostLinkScanInput[]): Promise<PostLinkScanResult[]> {
  const [baseUrl, index] = await Promise.all([getBaseUrl(), loadInternalIndex()])
  const agent = userAgent(baseUrl)

  interface Pending {
    postId: string
    url: string
    text: string
    internalPath: string | null
  }

  const pending: Pending[] = []
  for (const post of posts) {
    const seen = new Set<string>()
    for (const link of extractLinks(post.content)) {
      const href = link.href.trim()
      if (!href || href.startsWith("#")) continue
      if (/^(mailto:|tel:|sms:|javascript:|data:)/i.test(href)) continue
      // One row per URL per post: a post linking the same source five times is
      // one thing to fix, not five.
      if (seen.has(href.toLowerCase())) continue
      seen.add(href.toLowerCase())

      pending.push({
        postId: post.postId,
        url: href,
        text: link.text.slice(0, 200),
        internalPath: toInternalPath(href, baseUrl),
      })
    }
  }

  const externalUrls = Array.from(
    new Set(pending.filter((item) => item.internalPath === null).map((item) => item.url))
  )
  const externalResults = new Map<string, CachedResult>()
  const checked = await mapWithConcurrency(externalUrls, CONCURRENCY, async (url) => ({
    url,
    outcome: await checkExternal(url, agent),
  }))
  for (const entry of checked) externalResults.set(entry.url, entry.outcome)

  const byPost = new Map<string, CheckedLink[]>(posts.map((post) => [post.postId, []]))
  for (const item of pending) {
    const link: CheckedLink =
      item.internalPath !== null
        ? { url: item.url, text: item.text, ...resolveInternal(item.internalPath, index) }
        : {
            url: item.url,
            text: item.text,
            isInternal: false,
            ...(externalResults.get(item.url) ?? {
              statusCode: null,
              result: "unverifiable" as const,
              note: "Not checked.",
            }),
          }
    byPost.get(item.postId)?.push(link)
  }

  return posts.map((post) => ({ postId: post.postId, links: byPost.get(post.postId) ?? [] }))
}

/** Convenience for the per-post scan on the edit screen. */
export async function scanOnePost(postId: string): Promise<CheckedLink[]> {
  const [post] = await db
    .select({ id: blogPosts.id, content: blogPosts.content })
    .from(blogPosts)
    .where(eq(blogPosts.id, postId))
    .limit(1)

  if (!post) return []
  const [result] = await scanPostLinks([{ postId: post.id, content: post.content }])
  return result?.links ?? []
}
