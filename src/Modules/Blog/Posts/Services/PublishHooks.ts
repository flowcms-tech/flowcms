import "server-only"

import { revalidatePath } from "next/cache"
import { CacheService } from "@/Framework/Redis/CacheService"
import { getBaseUrl } from "@/Framework/Settings/SettingsService"
import { submitToIndexNow } from "@/Framework/Integrations/IndexNow"

/**
 * What has to happen the moment a post's public state changes.
 *
 * **The sitemap ping endpoints are dead.** Google retired `/ping?sitemap=` in
 * June 2023 and Bing followed. Every guide still telling you to GET
 * `google.com/ping?sitemap=…` on publish is out of date, and adding one back
 * here would be a request that is answered with a 404 and nothing else. The
 * working replacements are IndexNow (step 3) and a Search Console sitemap
 * submit through the API (step 4) — do not add a ping.
 *
 * Steps 1 and 2 are our own caches and must complete: skipping them serves a
 * reader the old page. Steps 3 and 4 are notifications to third parties and are
 * wrapped so they can never fail the publish — an editor clicking Publish is
 * not waiting on Bing, and a network blip at Yandex must not turn into a 500 on
 * a save that already committed.
 *
 * Lives in `Services/` beside `BlogPostServices.ts` but is the mirror image of
 * it: that file is the client's route to the API, this one is server-only and
 * is called *from* the routes. It takes plain data rather than reading the
 * database itself, which keeps the "no DB access in src/Modules" rule intact —
 * the caller already has the rows loaded anyway.
 */

export interface PublishHookInput {
  id: string
  slug: string
  /** The slug the post was previously served at, when this publish accompanied
   *  a rename. Both URLs get submitted: the old one so the engines re-crawl it
   *  and pick up the 301, the new one so the destination is discovered without
   *  waiting for that crawl. */
  previousSlug?: string | null
  /** Slugs of the linked categories/tags — their archives now list (or no
   *  longer list) this post, so their cached renders are stale too. */
  categorySlugs?: string[]
  tagSlugs?: string[]
  authorSlug?: string | null
}

/** Long enough for a normal round trip, short enough that four dead endpoints
 *  cannot add a visible pause to a save. */
const NOTIFY_TIMEOUT_MS = 6000

function revalidatePublicSurfaces(post: PublishHookInput): void {
  // The literal post path and the route pattern: the first refreshes the page
  // itself, the second covers a rename where the old path's cache entry is
  // keyed under a slug we are no longer passing.
  revalidatePath(`/blog/${post.slug}`)
  if (post.previousSlug && post.previousSlug !== post.slug) {
    revalidatePath(`/blog/${post.previousSlug}`)
  }
  revalidatePath("/blog")
  revalidatePath("/blog/[slug]", "page")

  for (const slug of post.categorySlugs ?? []) revalidatePath(`/blog/category/${slug}`)
  for (const slug of post.tagSlugs ?? []) revalidatePath(`/blog/tag/${slug}`)
  if (post.authorSlug) revalidatePath(`/blog/author/${post.authorSlug}`)

  // The sitemap and the feed are route handlers, not pages, but revalidatePath
  // invalidates cached data inside those too.
  revalidatePath("/sitemap.xml")
  revalidatePath("/blog/rss.xml")
}

/**
 * Runs a notification with its own timeout and swallows everything.
 *
 * `Promise.race` rather than an `AbortSignal` because each integration already
 * owns its own request timeout — this is the outer bound on the whole helper,
 * including the settings read it does first, so a stalled Redis cannot hold a
 * publish open either.
 */
async function fireAndForget(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await Promise.race([
      run(),
      new Promise((resolve) => setTimeout(resolve, NOTIFY_TIMEOUT_MS)),
    ])
  } catch (error) {
    console.warn(`[PublishHooks] ${label} failed:`, error)
  }
}

/**
 * Search Console's `sitemaps.submit`, if it has been written yet.
 *
 * Behind a dynamic import on purpose: the helper lives in
 * `GoogleSearchConsole.ts`, which at the time of writing exposes only the OAuth
 * and `listSites` calls. A static import of a missing export is a build error
 * for a step that is optional by design, so this resolves it at call time and
 * treats "not implemented" the same as "not connected" — silence, not a crash.
 *
 * Note the scope cost recorded in the spec: submitting a sitemap needs the
 * read-write `webmasters` scope, and an account connected under
 * `webmasters.readonly` will fail here with an insufficient-scope error until
 * it is reconnected. That surfaces as a log line, never as a failed publish.
 */
async function submitSitemapToSearchConsole(): Promise<void> {
  const gsc = (await import("@/Framework/Integrations/GoogleSearchConsole")) as Record<
    string,
    unknown
  >
  const submit = gsc.submitSitemap
  if (typeof submit !== "function") return

  const base = await getBaseUrl()
  await (submit as (sitemapUrl: string) => Promise<unknown>)(`${base}/sitemap-index.xml`)
}

async function notifySearchEngines(urls: string[], removed: boolean): Promise<void> {
  const targets = urls.filter(Boolean)
  if (targets.length === 0) return

  await Promise.all([
    fireAndForget("IndexNow", () => submitToIndexNow(targets)),
    // Google's Indexing API is off by default and outside its documented scope
    // for blog content — see the header of GoogleIndexing.ts. It is called here
    // only because the owner may have deliberately turned it on.
    fireAndForget("Google Indexing", async () => {
      const { submitToGoogleIndexing } = await import("@/Framework/Integrations/GoogleIndexing")
      await submitToGoogleIndexing(targets, removed ? "URL_DELETED" : "URL_UPDATED")
    }),
    fireAndForget("GSC sitemap submit", submitSitemapToSearchConsole),
  ])
}

async function buildUrls(post: PublishHookInput): Promise<string[]> {
  const base = await getBaseUrl()
  const urls = [`${base}/blog/${post.slug}`]
  if (post.previousSlug && post.previousSlug !== post.slug) {
    urls.push(`${base}/blog/${post.previousSlug}`)
  }
  return urls
}

/**
 * A post just went live, or a live post got a substantive update.
 *
 * Deliberately not called for an ordinary save. A typo fix does not change what
 * search engines hold, and submitting one teaches IndexNow to rate-limit us for
 * the changes that do matter.
 */
export async function onPostPublished(post: PublishHookInput): Promise<void> {
  revalidatePublicSurfaces(post)
  await CacheService.delPattern("blog-posts:*")
  await notifySearchEngines(await buildUrls(post), false)
}

/** A post was unpublished or trashed. Same invalidation, and the engines are
 *  told the URL is gone so the result drops out sooner than the next crawl. */
export async function onPostUnpublished(post: PublishHookInput): Promise<void> {
  revalidatePublicSurfaces(post)
  await CacheService.delPattern("blog-posts:*")
  await notifySearchEngines(await buildUrls(post), true)
}
