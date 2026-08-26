import { and, eq, inArray, isNull } from "drizzle-orm"
import { db } from "./client"
import { blogPostCategories, blogPosts, blogPostTags } from "@/db/tables"

/**
 * Post counts per taxonomy, for the category and tag admin lists.
 *
 * Two numbers rather than one, because they answer different questions and
 * conflating them is what makes the "empty archive" rule feel like a bug:
 * `total` is what an editor means by "how many posts are in this tag", while
 * `indexable` is the number the public side's empty-archive rule actually
 * reads. A tag holding three noindex posts has `total: 3, indexable: 0` and is
 * noindexed — showing only `total` there would make the automatic behaviour
 * look arbitrary.
 *
 * Always computed, never stored: a stored count goes stale the moment a post
 * is published, trashed, or has its own `isIndexable` flipped.
 */
export interface TaxonomyPostCounts {
  /** Published, untrashed posts linked to each taxonomy id. */
  total: Map<string, number>
  /** The subset that is also `isIndexable` — the empty-archive predicate. */
  indexable: Map<string, number>
}

/** Mirrors the predicate in `sitemapQueries.countPostsByTaxonomy`, so "counts
 *  as a real post" means the same thing in the admin list as it does in the
 *  sitemap and the archive's own robots tag. */
async function countLinks(
  links: { postId: string; taxonomyId: string }[]
): Promise<TaxonomyPostCounts> {
  const total = new Map<string, number>()
  const indexable = new Map<string, number>()
  if (links.length === 0) return { total, indexable }

  const postIds = Array.from(new Set(links.map((link) => link.postId)))
  const rows = await db.query.blogPosts.findMany({
    where: and(
      inArray(blogPosts.id, postIds),
      eq(blogPosts.isPublished, true),
      isNull(blogPosts.deletedAt)
    ),
    columns: { id: true, isIndexable: true },
  })

  const publishedIds = new Set(rows.map((row) => row.id))
  const indexableIds = new Set(rows.filter((row) => row.isIndexable).map((row) => row.id))

  for (const link of links) {
    if (!publishedIds.has(link.postId)) continue
    total.set(link.taxonomyId, (total.get(link.taxonomyId) ?? 0) + 1)
    if (indexableIds.has(link.postId)) {
      indexable.set(link.taxonomyId, (indexable.get(link.taxonomyId) ?? 0) + 1)
    }
  }

  return { total, indexable }
}

/** Omit `categoryId` for the whole list; pass it for a single-row read. */
export async function getBlogCategoryPostCounts(categoryId?: string): Promise<TaxonomyPostCounts> {
  const links = await db.query.blogPostCategories.findMany(
    categoryId ? { where: eq(blogPostCategories.categoryId, categoryId) } : undefined
  )
  return countLinks(links.map((link) => ({ postId: link.postId, taxonomyId: link.categoryId })))
}

/** Omit `tagId` for the whole list; pass it for a single-row read. */
export async function getBlogTagPostCounts(tagId?: string): Promise<TaxonomyPostCounts> {
  const links = await db.query.blogPostTags.findMany(
    tagId ? { where: eq(blogPostTags.tagId, tagId) } : undefined
  )
  return countLinks(links.map((link) => ({ postId: link.postId, taxonomyId: link.tagId })))
}
