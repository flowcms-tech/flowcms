import { z } from 'zod'

/**
 * The editorial review axis.
 *
 * Orthogonal to `isPublished`, and deliberately so: reworking the publish
 * boolean into a status enum is the one risky migration on the backlog, and
 * coupling it to approvals would make both harder to roll back. A post can be
 * published with `reviewStatus: "none"` — written by an editor who never needed
 * review — and that is the correct, common state, not a gap in the data.
 */
export const REVIEW_STATUSES = ['none', 'pending', 'approved', 'rejected'] as const

export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  none: 'Not submitted',
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Changes requested',
}

/** The three transitions the review route accepts. There is no "un-submit":
 *  a contributor who changes their mind edits the post, which is visible to the
 *  reviewer anyway, and a status that can be walked backwards makes the queue
 *  lie about what an editor already looked at. */
export const REVIEW_ACTIONS = ['submit', 'approve', 'reject'] as const

export type ReviewAction = (typeof REVIEW_ACTIONS)[number]

/**
 * A rejection requires a note, enforced by the schema rather than by the UI.
 *
 * A rejection with no reason produces a resubmission of the same post — the
 * contributor has nothing to act on, so the only rational move is to send it
 * back unchanged. Making the reason structurally mandatory is the difference
 * between a review workflow and a rejection button.
 */
export const reviewActionSchema = z
  .object({
    action: z.enum(REVIEW_ACTIONS),
    note: z.string().max(2000, 'Note must be 2000 characters or fewer').optional(),
  })
  .refine((value) => value.action !== 'reject' || !!value.note?.trim(), {
    message: 'A rejection needs a note explaining what to change',
    path: ['note'],
  })

export type ReviewActionPayload = z.infer<typeof reviewActionSchema>
