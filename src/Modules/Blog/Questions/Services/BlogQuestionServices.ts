import BAPI from '@/Framework/API_Layer'
import type { QuestionStatus } from '../Values/Validations'
import type { BlogQuestion, UpdateBlogQuestionPayload } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

export const BlogQuestionServices = {
  async list(params?: { status?: QuestionStatus; postId?: string }): Promise<BlogQuestion[]> {
    const res = await BAPI.get<ApiResponse<BlogQuestion[]>>(
      '/api/blog/questions',
      { params, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  /**
   * `keepEmptyStrings` because clearing an answer is a legitimate action —
   * "I answered the wrong question, let me start over" — and BAPI's default
   * payload sanitizer strips empty strings, which would silently turn a clear
   * into a no-op with no error and no visible symptom.
   */
  async update(id: string, payload: UpdateBlogQuestionPayload): Promise<BlogQuestion> {
    const res = await BAPI.patch<ApiResponse<BlogQuestion>>(
      `/api/blog/questions/${id}`,
      payload,
      { showGlobalError: false, showGlobalSuccess: true, keepEmptyStrings: true }
    )
    return res.data
  },

  async delete(id: string): Promise<void> {
    await BAPI.delete<ApiResponse<null>>(
      `/api/blog/questions/${id}`,
      undefined,
      { showGlobalError: true, showGlobalSuccess: true }
    )
  },
}
