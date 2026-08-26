import "server-only"

import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { db } from "@/db/client"
import { authors, blogCategories, blogPostCategories, blogPosts, blogPostTags, blogTags } from "@/db/tables"
import { publishDueScheduledPosts } from "@/db/blogPostScheduling"
import { publicImageUrl } from "@/Framework/Storage/publicImageUrl"
import { POSTS_PER_PAGE } from "./publicBlogQueries"
import type { PublicPostSummary } from "../Types"
import type { PublicAuthor } from "@/Themes/contract/views"

/**
 * Read layer for `/blog/author/[slug]`.
 *
 * Separate from publicBlogQueries.ts because `getPublishedPosts` filters by
 * category and tag only, and widening its signature for a third axis would
 * touch every existing caller. Same `server-only` guard and the same
 * publishDueScheduledPosts() entry rule.
 */

/** Defined on the theme contract since Phase 7.2: the author archive renders
 *  it, so the published package declares it. Re-exported for existing callers. */
export type { PublicAuthor } from "@/Themes/contract/views"

export interface AuthorPostsPage {
  posts: PublicPostSummary[]
  total: number
  page: number
  totalPages: number
}

/** Inactive authors resolve to null, so their archive 404s (and falls through
 *  to the redirect lookup) rather than rendering a byline the site has
 *  deliberately retired. `isIndexable` is NOT a filter here — a noindex author
 *  page is still publicly reachable, it just tells crawlers to skip it. */
export async function getAuthorBySlug(slug: string): Promise<PublicAuthor | null> {
  const row = await db.query.authors.findFirst({
    where: and(eq(authors.slug, slug), eq(authors.isActive, true)),
  })
  if (!row) return null

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    jobTitle: row.jobTitle,
    credentials: row.credentials,
    bio: row.bio,
    avatarUrl: row.avatarKey ? publicImageUrl(row.avatarKey) : null,
    avatarAltText: row.avatarAltText ?? row.name,
    sameAs: [row.websiteUrl, row.linkedinUrl, row.twitterUrl, row.facebookUrl, row.instagramUrl]
      .filter((url): url is string => !!url && url.trim() !== ""),
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    canonicalUrl: row.canonicalUrl,
    isIndexable: row.isIndexable,
  }
}

/**
 * The author's published posts, newest first.
 *
 * Every card on this page has the same byline, so the author block is resolved
 * once from the archive's own author row instead of re-joining it per post —
 * the posts are, by definition, exactly the ones that point at it.
 */
export async function getPublishedPostsByAuthor(
  author: PublicAuthor,
  page = 1
): Promise<AuthorPostsPage> {
  await publishDueScheduledPosts()

  const rows = await db.query.blogPosts.findMany({
    // isNull(deletedAt) alongside isPublished for the same reason the reader
    // queries carry both: trashing clears isPublished today, but relying on
    // that alone would resurrect a trashed post if anything ever set the flag
    // without clearing the trash.
    where: and(
      eq(blogPosts.authorProfileId, author.id),
      eq(blogPosts.isPublished, true),
      isNull(blogPosts.deletedAt)
    ),
    orderBy: desc(blogPosts.publishedAt),
  })

  const total = rows.length
  const totalPages = Math.max(1, Math.ceil(total / POSTS_PER_PAGE))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const slice = rows.slice((safePage - 1) * POSTS_PER_PAGE, safePage * POSTS_PER_PAGE)

  if (slice.length === 0) {
    return { posts: [], total, page: safePage, totalPages }
  }

  const postIds = slice.map((row) => row.id)
  const [categoryLinks, tagLinks, categories, tags] = await Promise.all([
    db.query.blogPostCategories.findMany({ where: inArray(blogPostCategories.postId, postIds) }),
    db.query.blogPostTags.findMany({ where: inArray(blogPostTags.postId, postIds) }),
    db.query.blogCategories.findMany({ where: eq(blogCategories.isActive, true) }),
    db.query.blogTags.findMany({ where: eq(blogTags.isActive, true) }),
  ])

  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const tagById = new Map(tags.map((t) => [t.id, t]))

  const categoriesByPost = new Map<string, PublicPostSummary["categories"]>()
  for (const link of categoryLinks) {
    const category = categoryById.get(link.categoryId)
    if (!category) continue
    const list = categoriesByPost.get(link.postId) ?? []
    list.push({ id: category.id, name: category.name, slug: category.slug })
    categoriesByPost.set(link.postId, list)
  }
  // Alphabetical, matching the reader queries: categories[0] is the
  // deterministic primary-category fallback, and "whichever row the join
  // returned first" can change between deploys.
  for (const list of categoriesByPost.values()) list.sort((a, b) => a.name.localeCompare(b.name))

  const tagsByPost = new Map<string, PublicPostSummary["tags"]>()
  for (const link of tagLinks) {
    const tag = tagById.get(link.tagId)
    if (!tag) continue
    const list = tagsByPost.get(link.postId) ?? []
    list.push({ id: tag.id, name: tag.name, slug: tag.slug })
    tagsByPost.set(link.postId, list)
  }

  const byline: PublicPostSummary["author"] = {
    id: author.id,
    name: author.name,
    isRealAuthor: true,
    slug: author.slug,
    jobTitle: author.jobTitle,
    credentials: author.credentials,
    bio: author.bio,
    avatarUrl: author.avatarUrl,
    avatarAltText: author.avatarAltText,
    sameAs: author.sameAs,
  }

  return {
    posts: slice.map((row) => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt,
      // Public URL, never presigned — crawlers revisit long after a signature
      // would have expired.
      featuredImageUrl: publicImageUrl(row.featuredImageKey),
      featuredImageAltText: row.featuredImageAltText || row.title,
      publishedAt: row.publishedAt,
      wordCount: row.wordCount,
      categories: categoriesByPost.get(row.id) ?? [],
      tags: tagsByPost.get(row.id) ?? [],
      author: byline,
    })),
    total,
    page: safePage,
    totalPages,
  }
}
