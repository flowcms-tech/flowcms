import BAPI from '@/Framework/API_Layer'
import type { BlogSeries, BlogSeriesPayload } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

export const BlogSeriesServices = {
  async list(search?: string): Promise<BlogSeries[]> {
    const res = await BAPI.get<ApiResponse<BlogSeries[]>>(
      '/api/blog/series',
      { params: search ? { search } : undefined, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async get(id: string): Promise<BlogSeries> {
    const res = await BAPI.get<ApiResponse<BlogSeries>>(
      `/api/blog/series/${id}`,
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async store(payload: BlogSeriesPayload): Promise<BlogSeries> {
    const res = await BAPI.post<ApiResponse<BlogSeries>>(
      '/api/blog/series',
      payload,
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async update(id: string, payload: Partial<BlogSeriesPayload> & { isActive?: boolean }): Promise<BlogSeries> {
    const res = await BAPI.patch<ApiResponse<BlogSeries>>(
      `/api/blog/series/${id}`,
      payload,
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async changeActive(id: string, isActive: boolean): Promise<BlogSeries> {
    const res = await BAPI.patch<ApiResponse<BlogSeries>>(
      `/api/blog/series/${id}`,
      { isActive },
      { showGlobalError: true, showGlobalSuccess: true }
    )
    return res.data
  },

  async delete(id: string): Promise<void> {
    await BAPI.delete<ApiResponse<null>>(
      `/api/blog/series/${id}`,
      undefined,
      { showGlobalError: true, showGlobalSuccess: true }
    )
  },
}
