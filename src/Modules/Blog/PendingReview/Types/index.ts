import type { ReviewStatus } from '@/Modules/Blog/Posts/Values/reviewWorkflow'

/**
 * The slice of a serialized post the review queue actually renders.
 *
 * Narrower than `BlogPost` on purpose: the queue is a decision screen, and
 * typing it against the full post shape would invite it to grow into a second
 * posts list with its own filters and its own drift.
 */
export interface PendingReviewPost extends Record<string, unknown> {
  id: string
  title: string
  slug: string
  excerpt: string
  wordCount: number | null
  seoScore: number | null
  isPublished: boolean
  createdBy: { id: string; name: string }
  reviewStatus: ReviewStatus
  reviewedBy: { id: string; name: string } | null
  reviewedAt: string | null
  reviewNote: string | null
  updatedAt?: string | null
}
