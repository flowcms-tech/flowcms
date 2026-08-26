import BAPI from '@/Framework/API_Layer'
import type { BlogPostFaq, BlogPostFaqPayload } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

export const BlogPostFaqServices = {
  async list(postId: string): Promise<BlogPostFaq[]> {
    const res = await BAPI.get<ApiResponse<BlogPostFaq[]>>(
      `/api/blog/posts/${postId}/faq`,
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async store(postId: string, payload: BlogPostFaqPayload): Promise<BlogPostFaq> {
    const res = await BAPI.post<ApiResponse<BlogPostFaq>>(
      `/api/blog/posts/${postId}/faq`,
      payload,
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async update(postId: string, faqId: string, payload: Partial<BlogPostFaqPayload>): Promise<BlogPostFaq> {
    const res = await BAPI.patch<ApiResponse<BlogPostFaq>>(
      `/api/blog/posts/${postId}/faq/${faqId}`,
      payload,
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async delete(postId: string, faqId: string): Promise<void> {
    await BAPI.delete<ApiResponse<null>>(
      `/api/blog/posts/${postId}/faq/${faqId}`,
      undefined,
      { showGlobalError: true, showGlobalSuccess: true }
    )
  },

  async reorder(postId: string, orderedIds: string[]): Promise<void> {
    await BAPI.post<ApiResponse<null>>(
      `/api/blog/posts/${postId}/faq/reorder`,
      { orderedIds },
      { showGlobalError: true, showGlobalSuccess: false }
    )
  },
}
