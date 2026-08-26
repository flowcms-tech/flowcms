import "server-only"

import type { MetadataRoute } from "next"
import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { db } from "@/db/client"
import { authors, blogCategories, blogPosts, blogTags, customPages } from "@/db/tables"
import { publishDueScheduledPosts } from "@/db/blogPostScheduling"
import { publicImageUrl } from "@/Framework/Storage/publicImageUrl"
import { joinUrl } from "../Values/buildPostMetadata"

/**
 * Read layer for the crawl surfaces — sitemap chunks and the news sitemap.
 *
 * Separate from publicBlogQueries.ts on purpose: those queries answer "what
 * does a reader see", these answer "what may we advertise to a crawler", and
 * the two have genuinely different exclusion rules (a noindex post is still
 * readable; an empty tag archive is still browsable). Keeping them apart stops
 * a change to one silently widening the other.
 *
 * Same `server-only` guard and same publishDueScheduledPosts() entry rule as
 * the reader queries — there is still no cron.
 */

/**
 * 5 000, not the protocol's 50 000. Smaller files regenerate faster and, more
 * importantly, Search Console reports errors per sitemap file — a 50 000-URL
 * file that reports "3 problems" is undiagnosable.
 */
export const SITEMAP_CHUNK_SIZE = 5000

/** Where ElementEditor uploads pasted in-content images. Mirrors the constant
 *  in src/app/api/public/images/[...key]/route.ts — see isPublicImageKey. */
const EDITOR_UPLOAD_PREFIX = "posts/"

const PUBLIC_IMAGE_ROUTE = "/api/public/images/"

export interface SitemapPostEntry {
  slug: string
  /** contentUpdatedAt ?? publishedAt — never row updatedAt, which bumps on a
   *  typo fix. Re-dating unchanged content is the pattern Google treats as
   *  manipulative, and lastModified is where a sitemap would tell that lie. */
  lastModified: Date | null
  /** Absolute URLs, already filtered to ones the public image route will
   *  actually serve. */
  images: string[]
}

export interface SitemapTaxonomyEntry {
  slug: string
  lastModified: Date
  postCount: number
}

export interface SitemapAuthorEntry {
  slug: string
  lastModified: Date
  postCount: number
}

/**
 * Pulls every `<img src>` out of stored post HTML and resolves the ones that
 * point at our own public image route back to their S3 key.
 *
 * Anything else is deliberately dropped:
 *  - an absolute external URL isn't ours to list in our sitemap;
 *  - a presigned S3 URL (what ElementEditor currently writes for images picked
 *    through the file manager) carries a signature that dies in about an hour,
 *    and a sitemap entry outlives that by weeks.
 */
function extractPublicImageKeys(html: string, base: string): string[] {
  const keys: string[] = []
  const pattern = /<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi

  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    let src = match[1].trim()
    if (base && src.startsWith(base)) src = src.slice(base.length)
    if (!src.startsWith(PUBLIC_IMAGE_ROUTE)) continue

    // Strip any query/fragment before decoding — the route matches on the
    // path segments alone.
    const path = src.slice(PUBLIC_IMAGE_ROUTE.length).split(/[?#]/)[0]
    if (!path) continue

    try {
      keys.push(path.split("/").map(decodeURIComponent).join("/"))
    } catch {
      // A malformed percent-escape can't be a key we ever wrote.
    }
  }

  return keys
}

/**
 * Every featured/OG image key that a published post references.
 *
 * This is half of the guard `/api/public/images/[...key]` applies. A sitemap
 * that advertises a URL which 404s is worse than one that omits it, so the
 * builder filters in-content keys through the same predicate rather than
 * assuming every `<img src>` in the body resolves.
 */
async function loadPublishedImageKeys(): Promise<Set<string>> {
  const rows = await db.query.blogPosts.findMany({
    where: eq(blogPosts.isPublished, true),
    columns: { featuredImageKey: true, ogImageKey: true },
  })

  const keys = new Set<string>()
  for (const row of rows) {
    if (row.featuredImageKey) keys.add(row.featuredImageKey)
    if (row.ogImageKey) keys.add(row.ogImageKey)
  }
  return keys
}

function isPublicImageKey(key: string, publishedKeys: Set<string>): boolean {
  return key.startsWith(EDITOR_UPLOAD_PREFIX) || publishedKeys.has(key)
}

/**
 * Every post that may appear in a sitemap, newest first, with its images.
 *
 * Exclusions: trashed, unpublished, `isIndexable = false`, and posts whose
 * `canonicalUrl` points somewhere else — a post disclaiming itself in favour
 * of another URL contradicts its own sitemap entry, and crawlers report that
 * pairing as an error rather than picking a winner.
 */
export async function getSitemapPostEntries(base: string): Promise<SitemapPostEntry[]> {
  await publishDueScheduledPosts()

  const [rows, publishedKeys] = await Promise.all([
    db.query.blogPosts.findMany({
      where: and(
        eq(blogPosts.isPublished, true),
        eq(blogPosts.isIndexable, true),
        isNull(blogPosts.deletedAt)
      ),
      orderBy: desc(blogPosts.publishedAt),
    }),
    loadPublishedImageKeys(),
  ])

  return rows
    .filter((row) => !row.canonicalUrl || row.canonicalUrl.includes(`/blog/${row.slug}`))
    .map((row) => {
      // Deduped and ordered: featured first, then OG if it differs, then
      // in-content in document order. Google reads at most 1 000 per URL.
      const candidates = [
        row.featuredImageKey,
        row.ogImageKey ?? "",
        ...extractPublicImageKeys(row.content, base),
      ]

      const seen = new Set<string>()
      const images: string[] = []
      for (const key of candidates) {
        if (!key || seen.has(key)) continue
        seen.add(key)
        if (!isPublicImageKey(key, publishedKeys)) continue
        images.push(publicImageUrl(key))
      }

      return {
        slug: row.slug,
        lastModified: row.contentUpdatedAt ?? row.publishedAt,
        images,
      }
    })
}

/** Counts published, indexable, untrashed posts per taxonomy id. */
async function countPostsByTaxonomy(
  links: { postId: string; taxonomyId: string }[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (links.length === 0) return counts

  const postIds = Array.from(new Set(links.map((link) => link.postId)))
  const eligible = await db.query.blogPosts.findMany({
    where: and(
      inArray(blogPosts.id, postIds),
      eq(blogPosts.isPublished, true),
      eq(blogPosts.isIndexable, true),
      isNull(blogPosts.deletedAt)
    ),
    columns: { id: true },
  })
  const eligibleIds = new Set(eligible.map((row) => row.id))

  for (const link of links) {
    if (!eligibleIds.has(link.postId)) continue
    counts.set(link.taxonomyId, (counts.get(link.taxonomyId) ?? 0) + 1)
  }
  return counts
}

/**
 * Category and tag archives worth advertising.
 *
 * Three filters, and the third is the one that isn't obvious: an archive with
 * zero published indexable posts is dropped **regardless of its own
 * `isIndexable` flag**. Emptiness is computed, never stored — a stored flag
 * goes stale the moment a post is published, and a tag archive rendering an
 * empty grid is the single most common source of thin indexed pages.
 */
export async function getIndexableTaxonomiesForSitemap(): Promise<{
  categories: SitemapTaxonomyEntry[]
  tags: SitemapTaxonomyEntry[]
}> {
  const [categories, tags, categoryLinks, tagLinks] = await Promise.all([
    db.query.blogCategories.findMany({
      where: and(eq(blogCategories.isActive, true), eq(blogCategories.isIndexable, true)),
    }),
    db.query.blogTags.findMany({
      where: and(eq(blogTags.isActive, true), eq(blogTags.isIndexable, true)),
    }),
    db.query.blogPostCategories.findMany(),
    db.query.blogPostTags.findMany(),
  ])

  const categoryCounts = await countPostsByTaxonomy(
    categoryLinks.map((link) => ({ postId: link.postId, taxonomyId: link.categoryId }))
  )
  const tagCounts = await countPostsByTaxonomy(
    tagLinks.map((link) => ({ postId: link.postId, taxonomyId: link.tagId }))
  )

  return {
    categories: categories
      .map((row) => ({
        slug: row.slug,
        lastModified: row.updatedAt,
        postCount: categoryCounts.get(row.id) ?? 0,
      }))
      .filter((entry) => entry.postCount > 0),
    tags: tags
      .map((row) => ({
        slug: row.slug,
        lastModified: row.updatedAt,
        postCount: tagCounts.get(row.id) ?? 0,
      }))
      .filter((entry) => entry.postCount > 0),
  }
}

/**
 * Author archives worth advertising: active, indexable, and carrying at least
 * one published post. An author page with no posts is a thin page, and adding
 * it to the sitemap is asking Google to index a byline and a blank grid.
 */
export async function getAuthorsForSitemap(): Promise<SitemapAuthorEntry[]> {
  const [authorRows, postRows] = await Promise.all([
    db.query.authors.findMany({
      where: and(eq(authors.isActive, true), eq(authors.isIndexable, true)),
    }),
    db.query.blogPosts.findMany({
      where: and(eq(blogPosts.isPublished, true), isNull(blogPosts.deletedAt)),
      columns: { authorProfileId: true },
    }),
  ])

  const counts = new Map<string, number>()
  for (const row of postRows) {
    if (!row.authorProfileId) continue
    counts.set(row.authorProfileId, (counts.get(row.authorProfileId) ?? 0) + 1)
  }

  return authorRows
    .map((row) => ({
      slug: row.slug,
      lastModified: row.updatedAt,
      postCount: counts.get(row.id) ?? 0,
    }))
    .filter((entry) => entry.postCount > 0)
}

export interface SitemapPageEntry {
  path: string
  lastModified: Date
}

/**
 * Published, indexable custom pages, excluding any whose `canonicalUrl`
 * points somewhere else — same reasoning as the post filter above: a page
 * disclaiming itself in favour of another URL contradicts its own sitemap
 * entry. `lastModified` reads `updatedAt` (not a separate
 * `contentUpdatedAt`-style column) — custom pages change rarely enough that
 * the typo-fix-vs-substantive-edit distinction Blog Posts makes isn't
 * worth a second timestamp column here.
 */
export async function getSitemapPageEntries(): Promise<SitemapPageEntry[]> {
  const rows = await db.query.customPages.findMany({
    where: and(eq(customPages.isPublished, true), eq(customPages.isIndexable, true)),
  })

  return rows
    .filter((row) => !row.canonicalUrl || row.canonicalUrl.includes(row.path))
    .map((row) => ({ path: row.path, lastModified: row.updatedAt }))
}

/**
 * The whole sitemap as one ordered list, before chunking.
 *
 * Assembled here rather than in `src/app/sitemap.ts` so the sitemap index at
 * `/sitemap.xml` can count the chunks from the exact same list the chunks are
 * sliced out of. An index advertising a chunk that turns out to be empty (or
 * missing one that isn't) is the one failure mode splitting a sitemap
 * introduces, and it can only be avoided by having a single source for the
 * count.
 *
 * Paginated archives are deliberately absent — page 1 only. They stay
 * crawlable through the pagination links; advertising every page of every
 * archive just spends crawl budget re-confirming posts already listed
 * individually.
 */
export async function buildSitemapEntries(base: string): Promise<MetadataRoute.Sitemap> {
  const [posts, taxonomies, authorEntries, pages] = await Promise.all([
    getSitemapPostEntries(base),
    getIndexableTaxonomiesForSitemap(),
    getAuthorsForSitemap(),
    getSitemapPageEntries(),
  ])

  return [
    { url: joinUrl(base, "/"), changeFrequency: "weekly", priority: 1 },
    { url: joinUrl(base, "/blog"), changeFrequency: "daily", priority: 0.8 },
    ...pages.map((page) => ({
      url: joinUrl(base, page.path),
      lastModified: page.lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.4,
    })),
    ...posts.map((post) => ({
      url: joinUrl(base, `/blog/${post.slug}`),
      lastModified: post.lastModified ?? undefined,
      changeFrequency: "monthly" as const,
      priority: 0.7,
      // What actually gets a blog into Google Images. Omitted entirely rather
      // than emitted empty — an empty <image:image> is a validation error.
      ...(post.images.length > 0 ? { images: post.images } : {}),
    })),
    ...taxonomies.categories.map((category) => ({
      url: joinUrl(base, `/blog/category/${category.slug}`),
      lastModified: category.lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
    ...authorEntries.map((author) => ({
      url: joinUrl(base, `/blog/author/${author.slug}`),
      lastModified: author.lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.4,
    })),
    ...taxonomies.tags.map((tag) => ({
      url: joinUrl(base, `/blog/tag/${tag.slug}`),
      lastModified: tag.lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.3,
    })),
  ]
}

/** How many `/sitemap/<id>.xml` chunks the current data needs. Always at least
 *  one — an empty sitemap is valid XML, a missing one is a 404 in Search
 *  Console. */
export async function countSitemapChunks(base: string): Promise<number> {
  const entries = await buildSitemapEntries(base)
  return Math.max(1, Math.ceil(entries.length / SITEMAP_CHUNK_SIZE))
}

/**
 * Posts eligible for a Google News sitemap: published in the last 48 hours
 * with `schemaType = "NewsArticle"`. Both halves are the protocol's, not a
 * preference — a News sitemap may only contain the last two days, and marking
 * an evergreen how-to as news is what gets a publisher account pulled.
 */
export async function getNewsSitemapPosts(): Promise<
  { slug: string; title: string; publishedAt: Date }[]
> {
  await publishDueScheduledPosts()

  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000)
  const rows = await db.query.blogPosts.findMany({
    where: and(
      eq(blogPosts.isPublished, true),
      eq(blogPosts.isIndexable, true),
      eq(blogPosts.schemaType, "NewsArticle"),
      isNull(blogPosts.deletedAt)
    ),
    orderBy: desc(blogPosts.publishedAt),
    columns: { slug: true, title: true, publishedAt: true },
  })

  return rows
    .filter((row): row is typeof row & { publishedAt: Date } => !!row.publishedAt)
    .filter((row) => row.publishedAt >= cutoff)
    .map((row) => ({ slug: row.slug, title: row.title, publishedAt: row.publishedAt }))
}
