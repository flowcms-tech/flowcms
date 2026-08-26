export interface BusinessReview extends Record<string, unknown> {
  id: string
  authorName: string
  /** 1-5. */
  rating: number
  body: string | null
  /** Where it came from — the audit trail that makes the markup defensible. */
  source: string
  sourceUrl: string | null
  /** ISO timestamp of when the customer left the review, not when it was typed in. */
  reviewedAt: string
  isPublished: boolean
  createdAt: string
}

export interface BusinessReviewPayload {
  authorName: string
  rating: number
  body?: string
  source: string
  sourceUrl?: string
  /** 'yyyy-MM-dd', as ElementDatePicker stores it. */
  reviewedAt: string
  isPublished?: boolean
}
