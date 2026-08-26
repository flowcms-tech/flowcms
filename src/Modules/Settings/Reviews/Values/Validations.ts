import { z } from 'zod'

export const createBusinessReviewSchema = z.object({
  authorName: z.string().min(1, 'Author name is required').max(150),
  rating:     z.number().int().min(1, 'Rating must be between 1 and 5').max(5, 'Rating must be between 1 and 5'),
  body:       z.string().max(2000).optional(),
  // Required, and deliberately so: it is the audit trail behind the
  // AggregateRating markup these rows feed. A review with no stated origin
  // cannot be defended if the markup is ever questioned.
  source:     z.string().min(1, 'Source is required').max(100),
  sourceUrl:  z.union([z.string().url('Invalid URL').max(500), z.literal('')]).optional(),
  reviewedAt: z.string()
    .min(1, 'Review date is required')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Review date must be a valid date'),
  isPublished: z.boolean().optional(),
})

export const updateBusinessReviewSchema = createBusinessReviewSchema.partial()

export type CreateBusinessReviewValues = z.infer<typeof createBusinessReviewSchema>
export type UpdateBusinessReviewValues = z.infer<typeof updateBusinessReviewSchema>

// -- Form-level variants ---------------------------------------------------
// ElementSelect values are always strings, but the API (and the DB column)
// wants rating as a real number — the same shape mismatch the Redirects
// module solves for statusCode. Converted with Number(...) right before
// calling the service.

const ratingFormField = z.string()
  .min(1, 'Rating is required')
  .regex(/^[1-5]$/, 'Rating must be between 1 and 5')

export const createBusinessReviewFormSchema = createBusinessReviewSchema.extend({
  rating: ratingFormField,
})
export const updateBusinessReviewFormSchema = createBusinessReviewSchema.extend({
  rating: ratingFormField,
})

export type CreateBusinessReviewFormFields = z.infer<typeof createBusinessReviewFormSchema>
export type UpdateBusinessReviewFormFields = z.infer<typeof updateBusinessReviewFormSchema>
