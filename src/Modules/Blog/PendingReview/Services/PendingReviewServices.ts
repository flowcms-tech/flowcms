import BAPI from '@/Framework/API_Layer'
import type { ReviewStatus } from '@/Modules/Blog/Posts/Values/reviewWorkflow'
import type { PendingReviewPost } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

export const PendingReviewServices = {
  /**
   * Reuses the posts list endpoint with its `reviewStatus` filter rather than
   * adding a queue-specific route. One serializer means the queue can never
   * disagree with the posts list about a post's state — and filtering
   * server-side means the queue doesn't download every post to find the three
   * that are waiting.
   */
  async list(status: ReviewStatus): Promise<PendingReviewPost[]> {
    const res = await BAPI.get<ApiResponse<PendingReviewPost[]>>(
      '/api/blog/posts',
      {
        params: { reviewStatus: status },
        showGlobalError: true,
        showGlobalSuccess: false,
      }
    )
    return res.data
  },
}
