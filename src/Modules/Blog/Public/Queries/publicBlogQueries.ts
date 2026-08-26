import "server-only"

import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm"
import { db } from "@/db/client"
import { blogCategories, blogPostCategories, blogPostFaqs, blogPostRelated, blogPosts, blogPostTags, blogSeries, blogTags, users } from "@/db/tables"
import { publishDueScheduledPosts } from "@/db/blogPostScheduling"
import { publicImageUrl } from "@/Framework/Storage/publicImageUrl"
import { scoreRelatedPosts, type RelatedCandidate } from "../Values/relatedPosts"
import type {
  PublicPost,
  PublicPostSummary,
  PublicSeriesPost,
  PublicTaxonomy,
} from "../Types"

/**
 * Read layer for the public blog.
 *
 * These deliberately hit the DB directly rather than going through `BAPI` —
 * a server component fetching this app's own HTTP route is a pointless round
 * trip. That brushes against the "no DB access in src/Modules" rule, whose
 * intent is keeping the DB client out of client bundles, so `server-only`
 * above turns any client import into a build error rather than a leak.
 *
 * Every entry point calls publishDueScheduledPosts() first: there is still no
 * cron, so a scheduled post goes live on the next read of any kind.
 */

export const POSTS_PER_PAGE = 9

/** Three cards is what the strip renders; asking the scorer for more would
 *  only produce rows nothing displays. */
const RELATED_LIMIT = 3

type PostRow = typeof blogPosts.$inferSelect

/** Stored JSON string columns (`speakableSelectors`) degrade to an empty list
 *  rather than throwing — this runs while rendering a live article, and a
 *  malformed payload is never worth a 500 on the post itself. */
function parseStringArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === "string" && value.trim() !== "")
  } catch {
    return []
  }
}

/** Published, not trashed, and not deliberately hidden from search. The shared
 *  predicate behind both the related-post candidate pool and the
 *  empty-taxonomy check, so "counts as a real indexable post" means one thing. */
function indexablePublishedWhere() {
  return and(
    eq(blogPosts.isPublished, true),
    eq(blogPosts.isIndexable, true),
    isNull(blogPosts.deletedAt)
  )
}

function ogImageKeyFor(row: PostRow): string {
  return row.ogImageKey || row.featuredImageKey
}

/** Resolves categories, tags, and authors for a batch of posts in one pass —
 *  the manual in-memory join convention this codebase already uses. */
async function attachRelations(rows: PostRow[]): Promise<PublicPostSummary[]> {
  if (rows.length === 0) return []

  const postIds = rows.map((row) => row.id)
  const creatorIds = Array.from(new Set(rows.map((row) => row.authorId)))

  const [categoryLinks, tagLinks, categories, tags, adminUsers, authorRows] = await Promise.all([
    db.query.blogPostCategories.findMany({ where: inArray(blogPostCategories.postId, postIds) }),
    db.query.blogPostTags.findMany({ where: inArray(blogPostTags.postId, postIds) }),
    db.query.blogCategories.findMany(),
    db.query.blogTags.findMany(),
    db.query.users.findMany({ where: inArray(users.id, creatorIds) }),
    db.query.authors.findMany(),
  ])

  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const tagById = new Map(tags.map((t) => [t.id, t]))
  const adminUserById = new Map(adminUsers.map((u) => [u.id, u]))
  const authorById = new Map(authorRows.map((a) => [a.id, a]))

  const categoriesByPost = new Map<string, PublicPostSummary["categories"]>()
  for (const link of categoryLinks) {
    const category = categoryById.get(link.categoryId)
    if (!category || !category.isActive) continue
    const list = categoriesByPost.get(link.postId) ?? []
    list.push({ id: category.id, name: category.name, slug: category.slug })
    categoriesByPost.set(link.postId, list)
  }
  // Alphabetical, so a post with no primaryCategoryId still gets the SAME
  // breadcrumb and articleSection on every deploy. Unsorted, the fallback is
  // whichever link row the join happened to return first.
  for (const list of categoriesByPost.values()) list.sort((a, b) => a.name.localeCompare(b.name))

  const tagsByPost = new Map<string, PublicPostSummary["tags"]>()
  for (const link of tagLinks) {
    const tag = tagById.get(link.tagId)
    if (!tag || !tag.isActive) continue
    const list = tagsByPost.get(link.postId) ?? []
    list.push({ id: tag.id, name: tag.name, slug: tag.slug })
    tagsByPost.set(link.postId, list)
  }
  for (const list of tagsByPost.values()) list.sort((a, b) => a.name.localeCompare(b.name))

  return rows.map((row) => {
    const adminUser = adminUserById.get(row.authorId)
    const authorProfile = row.authorProfileId ? authorById.get(row.authorProfileId) : undefined

    // A real author wins; the creating admin is only a fallback so a
    // pre-Authors-module post never renders an empty byline.
    const author = authorProfile
      ? {
          id: authorProfile.id,
          name: authorProfile.name,
          isRealAuthor: true,
          slug: authorProfile.slug,
          jobTitle: authorProfile.jobTitle,
          credentials: authorProfile.credentials,
          bio: authorProfile.bio,
          avatarUrl: authorProfile.avatarKey ? publicImageUrl(authorProfile.avatarKey) : null,
          avatarAltText: authorProfile.avatarAltText ?? authorProfile.name,
          sameAs: [
            authorProfile.websiteUrl,
            authorProfile.linkedinUrl,
            authorProfile.twitterUrl,
            authorProfile.facebookUrl,
            authorProfile.instagramUrl,
          ].filter((url): url is string => !!url && url.trim() !== ""),
        }
      : {
          id: row.authorId,
          name: adminUser?.name ?? "",
          isRealAuthor: false,
          slug: null,
          jobTitle: null,
          credentials: null,
          bio: null,
          avatarUrl: null,
          avatarAltText: null,
          sameAs: [],
        }

    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt,
      // Public URL, never presigned — crawlers revisit long after a
      // signature would have expired.
      featuredImageUrl: publicImageUrl(row.featuredImageKey),
      // Falling back to the title keeps old rows from rendering alt="",
      // which screen readers announce as decorative.
      featuredImageAltText: row.featuredImageAltText || row.title,
      publishedAt: row.publishedAt,
      wordCount: row.wordCount,
      categories: categoriesByPost.get(row.id) ?? [],
      tags: tagsByPost.get(row.id) ?? [],
      author,
    }
  })
}

export interface PublishedPostsPage {
  posts: PublicPostSummary[]
  total: number
  page: number
  totalPages: number
}

export async function getPublishedPosts({
  page = 1,
  categorySlug,
  tagSlug,
}: {
  page?: number
  categorySlug?: string
  tagSlug?: string
} = {}): Promise<PublishedPostsPage> {
  await publishDueScheduledPosts()

  let postIdFilter: string[] | null = null

  if (categorySlug) {
    const category = await db.query.blogCategories.findFirst({
      where: and(eq(blogCategories.slug, categorySlug), eq(blogCategories.isActive, true)),
    })
    if (!category) return { posts: [], total: 0, page, totalPages: 0 }
    const links = await db.query.blogPostCategories.findMany({
      where: eq(blogPostCategories.categoryId, category.id),
    })
    postIdFilter = links.map((l) => l.postId)
  }

  if (tagSlug) {
    const tag = await db.query.blogTags.findFirst({
      where: and(eq(blogTags.slug, tagSlug), eq(blogTags.isActive, true)),
    })
    if (!tag) return { posts: [], total: 0, page, totalPages: 0 }
    const links = await db.query.blogPostTags.findMany({ where: eq(blogPostTags.tagId, tag.id) })
    const tagPostIds = links.map((l) => l.postId)
    postIdFilter = postIdFilter ? postIdFilter.filter((id) => tagPostIds.includes(id)) : tagPostIds
  }

  if (postIdFilter && postIdFilter.length === 0) {
    return { posts: [], total: 0, page, totalPages: 0 }
  }

  const rows = await db.query.blogPosts.findMany({
    // isNull(deletedAt): a trashed post is unpublished on trash anyway, but
    // relying on that alone would resurrect it if anything ever set
    // isPublished without clearing the trash flag.
    where: postIdFilter
      ? and(eq(blogPosts.isPublished, true), isNull(blogPosts.deletedAt), inArray(blogPosts.id, postIdFilter))
      : and(eq(blogPosts.isPublished, true), isNull(blogPosts.deletedAt)),
    orderBy: desc(blogPosts.publishedAt),
  })

  const total = rows.length
  const totalPages = Math.max(1, Math.ceil(total / POSTS_PER_PAGE))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const slice = rows.slice((safePage - 1) * POSTS_PER_PAGE, safePage * POSTS_PER_PAGE)

  return { posts: await attachRelations(slice), total, page: safePage, totalPages }
}

export interface PostBySlugOptions {
  /**
   * Drops the `isPublished` filter, for share-preview links only.
   *
   * The caller MUST have verified a preview token first — this flag is the
   * whole difference between "a draft" and "a public page", so it is
   * deliberately explicit at every call site rather than inferred from a
   * request. Trashed posts stay excluded either way: a preview of something
   * someone deleted is not a feature.
   */
  includeUnpublished?: boolean
}

export async function getPublishedPostBySlug(
  slug: string,
  { includeUnpublished = false }: PostBySlugOptions = {}
): Promise<PublicPost | null> {
  await publishDueScheduledPosts()

  const row = await db.query.blogPosts.findFirst({
    where: and(
      eq(blogPosts.slug, slug),
      ...(includeUnpublished ? [] : [eq(blogPosts.isPublished, true)]),
      isNull(blogPosts.deletedAt)
    ),
  })
  if (!row) return null

  const [[summary], faqs, series] = await Promise.all([
    attachRelations([row]),
    db.query.blogPostFaqs.findMany({
      where: eq(blogPostFaqs.postId, row.id),
      orderBy: asc(blogPostFaqs.priority),
    }),
    row.seriesId
      ? db.query.blogSeries.findFirst({
          where: and(eq(blogSeries.id, row.seriesId), eq(blogSeries.isActive, true)),
        })
      : Promise.resolve(undefined),
  ])

  return {
    ...summary,
    content: row.content,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    canonicalUrl: row.canonicalUrl,
    ogImageUrl: publicImageUrl(ogImageKeyFor(row)),
    isIndexable: row.isIndexable,
    updatedAt: row.updatedAt,
    contentUpdatedAt: row.contentUpdatedAt,
    isCornerstone: row.isCornerstone,
    seriesId: row.seriesId,
    seriesPosition: row.seriesPosition,
    series: series ? { id: series.id, name: series.name, slug: series.slug } : null,
    primaryCategoryId: row.primaryCategoryId,
    schemaType: row.schemaType,
    schemaData: row.schemaData,
    speakableSelectors: parseStringArray(row.speakableSelectors),
    focusKeyword: row.focusKeyword,
    faqs: faqs.map((f) => ({ id: f.id, question: f.question, answer: f.answer })),
  }
}

/**
 * The related-post strip.
 *
 * Manual `blog_post_related` rows win **entirely** when any of them survives
 * the validity filter — they are not blended with, or topped up from, the
 * automatic scores. A half-honoured override is worse than none, because the
 * editor cannot tell whether their choice took effect. Automatic scoring runs
 * only when there are no usable manual rows at all (including the case where
 * every manual pick has since been trashed).
 *
 * Candidates on both paths exclude self, unpublished, trashed, and
 * `isIndexable = false` posts: recommending a post deliberately hidden from
 * search is incoherent, and only this layer knows those flags.
 */
export async function getRelatedPosts(post: PublicPost): Promise<PublicPostSummary[]> {
  await publishDueScheduledPosts()

  const manualLinks = await db.query.blogPostRelated.findMany({
    where: eq(blogPostRelated.postId, post.id),
    orderBy: asc(blogPostRelated.position),
  })

  if (manualLinks.length > 0) {
    const manualIds = manualLinks.map((link) => link.relatedPostId).filter((id) => id !== post.id)
    if (manualIds.length > 0) {
      const rows = await db.query.blogPosts.findMany({
        where: and(indexablePublishedWhere(), inArray(blogPosts.id, manualIds)),
      })
      const byId = new Map(rows.map((row) => [row.id, row]))
      // Re-ordered by the editor's `position`, not by whatever order SQLite
      // returned — the ordering is the point of the override.
      const ordered = manualIds
        .map((id) => byId.get(id))
        .filter((row): row is PostRow => !!row)
        .slice(0, RELATED_LIMIT)
      if (ordered.length > 0) return attachRelations(ordered)
    }
  }

  const rows = await db.query.blogPosts.findMany({
    where: and(indexablePublishedWhere(), ne(blogPosts.id, post.id)),
  })
  if (rows.length === 0) return []

  const candidateIds = rows.map((row) => row.id)
  const [categoryLinks, tagLinks] = await Promise.all([
    db.query.blogPostCategories.findMany({
      where: inArray(blogPostCategories.postId, [...candidateIds, post.id]),
    }),
    db.query.blogPostTags.findMany({
      where: inArray(blogPostTags.postId, [...candidateIds, post.id]),
    }),
  ])

  const categoryIdsByPost = new Map<string, string[]>()
  for (const link of categoryLinks) {
    categoryIdsByPost.set(link.postId, [...(categoryIdsByPost.get(link.postId) ?? []), link.categoryId])
  }
  const tagIdsByPost = new Map<string, string[]>()
  for (const link of tagLinks) {
    tagIdsByPost.set(link.postId, [...(tagIdsByPost.get(link.postId) ?? []), link.tagId])
  }

  const candidates: RelatedCandidate[] = rows.map((row) => ({
    id: row.id,
    publishedAt: row.publishedAt,
    categoryIds: categoryIdsByPost.get(row.id) ?? [],
    primaryCategoryId: row.primaryCategoryId,
    tagIds: tagIdsByPost.get(row.id) ?? [],
    seriesId: row.seriesId,
    isCornerstone: row.isCornerstone,
  }))

  const target: RelatedCandidate = {
    id: post.id,
    publishedAt: post.publishedAt,
    categoryIds: categoryIdsByPost.get(post.id) ?? post.categories.map((c) => c.id),
    primaryCategoryId: post.primaryCategoryId,
    tagIds: tagIdsByPost.get(post.id) ?? post.tags.map((t) => t.id),
    seriesId: post.seriesId,
    isCornerstone: post.isCornerstone,
  }

  const rankedIds = scoreRelatedPosts(target, candidates, RELATED_LIMIT)
  const byId = new Map(rows.map((row) => [row.id, row]))
  const ranked = rankedIds.map((id) => byId.get(id)).filter((row): row is PostRow => !!row)
  return attachRelations(ranked)
}

/**
 * Every part of a series, in `seriesPosition` order.
 *
 * Unpublished parts are returned rather than filtered: the strip renders them
 * as plain text, so "Part 4 of 5" stays honest instead of silently becoming
 * "Part 4 of 4" the moment a draft exists. Trashed posts are excluded — those
 * are not upcoming, they are gone.
 */
export async function getSeriesPosts(seriesId: string): Promise<PublicSeriesPost[]> {
  await publishDueScheduledPosts()

  const rows = await db.query.blogPosts.findMany({
    where: and(eq(blogPosts.seriesId, seriesId), isNull(blogPosts.deletedAt)),
    orderBy: [asc(blogPosts.seriesPosition), asc(blogPosts.publishedAt)],
  })

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    seriesPosition: row.seriesPosition,
    isPublished: row.isPublished,
  }))
}

/**
 * How many published, indexable posts an archive actually holds.
 *
 * Computed on every read, never stored. A stored flag or counter goes stale
 * the moment a post is published or trashed, and the value decides whether the
 * archive is noindex — a stale "0" would quietly de-index a live archive.
 */
async function countIndexablePosts(
  linkedPostIds: string[]
): Promise<number> {
  if (linkedPostIds.length === 0) return 0
  const rows = await db.query.blogPosts.findMany({
    where: and(indexablePublishedWhere(), inArray(blogPosts.id, linkedPostIds)),
    columns: { id: true },
  })
  return rows.length
}

export async function getCategoryBySlug(slug: string): Promise<PublicTaxonomy | null> {
  const row = await db.query.blogCategories.findFirst({
    where: and(eq(blogCategories.slug, slug), eq(blogCategories.isActive, true)),
  })
  if (!row) return null

  const links = await db.query.blogPostCategories.findMany({
    where: eq(blogPostCategories.categoryId, row.id),
  })

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    canonicalUrl: row.canonicalUrl,
    isIndexable: row.isIndexable,
    archiveIntro: row.archiveIntro,
    indexablePostCount: await countIndexablePosts(links.map((link) => link.postId)),
  }
}

export async function getTagBySlug(slug: string): Promise<PublicTaxonomy | null> {
  const row = await db.query.blogTags.findFirst({
    where: and(eq(blogTags.slug, slug), eq(blogTags.isActive, true)),
  })
  if (!row) return null

  const links = await db.query.blogPostTags.findMany({ where: eq(blogPostTags.tagId, row.id) })

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: null,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    canonicalUrl: row.canonicalUrl,
    isIndexable: row.isIndexable,
    archiveIntro: row.archiveIntro,
    indexablePostCount: await countIndexablePosts(links.map((link) => link.postId)),
  }
}

// `getIndexablePostsForSitemap` and `getActiveTaxonomiesForSitemap` used to
// live here. They are superseded by `./sitemapQueries.ts`, which additionally
// handles chunking, per-post image entries, author archives, and the
// empty-taxonomy rule.
//
// Deleted rather than kept as a fallback: two implementations of "what belongs
// in the sitemap" is exactly the pair that drifts, and the stale one wins
// silently the moment someone imports it by name.

/** Newest posts for the RSS feed. */
export async function getRecentPostsForFeed(limit = 20): Promise<PublicPostSummary[]> {
  await publishDueScheduledPosts()
  const rows = await db.query.blogPosts.findMany({
    where: and(eq(blogPosts.isPublished, true), isNull(blogPosts.deletedAt)),
    orderBy: desc(blogPosts.publishedAt),
    limit,
  })
  return attachRelations(rows)
}
