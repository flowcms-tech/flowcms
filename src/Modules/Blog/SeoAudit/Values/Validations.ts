import { z } from 'zod'

/**
 * Shared by the link-check route and the audit dashboard, per the repo
 * convention that routes import their Zod schemas from the module they serve
 * rather than declaring a second copy.
 */

export const linkScanSchema = z.object({
  /** Omit to scan every non-trashed post. Present to scan just one — the
   *  per-post button on the edit screen. */
  postId: z.string().min(1, 'Post id cannot be empty.').optional(),
})

export type LinkScanValues = z.infer<typeof linkScanSchema>
