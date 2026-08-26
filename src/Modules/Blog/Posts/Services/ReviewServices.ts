import BAPI from '@/Framework/API_Layer'
import type { ReviewAction, ReviewStatus } from '../Values/reviewWorkflow'

interface ApiResponse<T> { data: T; message: string | string[] }

export interface ReviewResult {
  id: string
  reviewStatus: ReviewStatus
  reviewedById: string | null
  reviewedAt: string | null
  reviewNote: string | null
}

export const ReviewServices = {
  /**
   * The one call behind Submit / Approve / Reject.
   *
   * `showGlobalError: false` because every refusal this route issues is
   * actionable prose the caller renders inline — "you can't review your own
   * post", "a rejection needs a note". A toast would discard the note the
   * editor just typed along with the message telling them why.
   */
  async act(postId: string, action: ReviewAction, note?: string): Promise<ReviewResult> {
    const res = await BAPI.post<ApiResponse<ReviewResult>>(
      `/api/blog/posts/${postId}/review`,
      { action, note },
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },
}
