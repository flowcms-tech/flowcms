/**
 * Related-post scoring. Pure arithmetic over rows the caller has already
 * loaded — no DB access here, so the same function serves the public post page,
 * the admin "suggested related posts" list, and any future audit that wants to
 * know which posts are orphaned.
 *
 * **The caller filters, this function ranks.** Candidates must already exclude
 * unpublished, trashed, and `isIndexable = false` posts: recommending a post
 * you have deliberately hidden from search is incoherent, and only the query
 * layer knows those flags. Manual overrides from `blog_post_related` win
 * outright and are prepended by the caller; this fills the remainder.
 */

export interface RelatedCandidate {
  id: string
  publishedAt: Date | null
  categoryIds: string[]
  primaryCategoryId: string | null
  tagIds: string[]
  seriesId: string | null
  isCornerstone: boolean
}

const WEIGHT_PRIMARY_CATEGORY = 5
const WEIGHT_SECONDARY_CATEGORY = 3
const WEIGHT_TAG = 1
const WEIGHT_CORNERSTONE = 2
const WEIGHT_SAME_SERIES = 4

/**
 * The cornerstone bonus applies to the **candidate**, not to the post being
 * viewed. Spec §2.5 states it directly ("a cornerstone post ranks higher in
 * related-post scoring"), and it is the only reading that does anything: a
 * bonus keyed off the target would be a constant added to every candidate and
 * could not change the order it is meant to change.
 */
function scoreCandidate(target: RelatedCandidate, candidate: RelatedCandidate): number {
  let score = 0

  const targetCategories = new Set(target.categoryIds)
  for (const categoryId of candidate.categoryIds) {
    if (!targetCategories.has(categoryId)) continue
    // A category both posts treat as *primary* is a much stronger signal than
    // one they happen to share among five others.
    score +=
      categoryId === target.primaryCategoryId && categoryId === candidate.primaryCategoryId
        ? WEIGHT_PRIMARY_CATEGORY
        : WEIGHT_SECONDARY_CATEGORY
  }

  const targetTags = new Set(target.tagIds)
  for (const tagId of candidate.tagIds) {
    if (targetTags.has(tagId)) score += WEIGHT_TAG
  }

  if (candidate.isCornerstone) score += WEIGHT_CORNERSTONE
  if (target.seriesId && candidate.seriesId === target.seriesId) score += WEIGHT_SAME_SERIES

  return score
}

export function scoreRelatedPosts(
  target: RelatedCandidate,
  candidates: RelatedCandidate[],
  limit = 3
): string[] {
  return candidates
    .filter((candidate) => candidate.id !== target.id)
    .map((candidate) => ({ id: candidate.id, score: scoreCandidate(target, candidate), publishedAt: candidate.publishedAt }))
    // Zero means nothing in common — no shared taxonomy, no series, not
    // cornerstone. Padding the strip out to three with unrelated posts is how
    // a "Related" block trains readers to ignore it.
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      // Newest first on a tie. Undated posts sort last, and `id` is the final
      // tiebreak so the same inputs always produce the same strip — an
      // order that flips between renders defeats the page cache.
      const aTime = a.publishedAt ? a.publishedAt.getTime() : -Infinity
      const bTime = b.publishedAt ? b.publishedAt.getTime() : -Infinity
      if (bTime !== aTime) return bTime - aTime
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    .slice(0, limit)
    .map((entry) => entry.id)
}
