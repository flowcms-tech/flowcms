import BAPI from '@/Framework/API_Layer'
import type { BusinessReview, BusinessReviewPayload } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

export const BusinessReviewServices = {
  async list(search?: string): Promise<BusinessReview[]> {
    const res = await BAPI.get<ApiResponse<BusinessReview[]>>(
      '/api/business-reviews',
      { params: search ? { search } : undefined, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async get(id: string): Promise<BusinessReview> {
    const res = await BAPI.get<ApiResponse<BusinessReview>>(
      `/api/business-reviews/${id}`,
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async store(payload: BusinessReviewPayload): Promise<BusinessReview> {
    const res = await BAPI.post<ApiResponse<BusinessReview>>(
      '/api/business-reviews',
      payload,
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async update(id: string, payload: Partial<BusinessReviewPayload>): Promise<BusinessReview> {
    const res = await BAPI.patch<ApiResponse<BusinessReview>>(
      `/api/business-reviews/${id}`,
      payload,
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async changePublished(id: string, isPublished: boolean): Promise<BusinessReview> {
    const res = await BAPI.patch<ApiResponse<BusinessReview>>(
      `/api/business-reviews/${id}`,
      { isPublished },
      { showGlobalError: true, showGlobalSuccess: true }
    )
    return res.data
  },

  async delete(id: string): Promise<void> {
    await BAPI.delete<ApiResponse<null>>(
      `/api/business-reviews/${id}`,
      undefined,
      { showGlobalError: true, showGlobalSuccess: true }
    )
  },
}
