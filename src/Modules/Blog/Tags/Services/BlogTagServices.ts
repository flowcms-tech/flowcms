import BAPI from '@/Framework/API_Layer'
import type { BlogTag, BlogTagPayload } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

export const BlogTagServices = {
  async list(search?: string): Promise<BlogTag[]> {
    const res = await BAPI.get<ApiResponse<BlogTag[]>>(
      '/api/blog/tags',
      { params: search ? { search } : undefined, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async get(id: string): Promise<BlogTag> {
    const res = await BAPI.get<ApiResponse<BlogTag>>(
      `/api/blog/tags/${id}`,
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async store(payload: BlogTagPayload): Promise<BlogTag> {
    const res = await BAPI.post<ApiResponse<BlogTag>>(
      '/api/blog/tags',
      payload,
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async update(id: string, payload: Partial<BlogTagPayload> & { isActive?: boolean }): Promise<BlogTag> {
    const res = await BAPI.patch<ApiResponse<BlogTag>>(
      `/api/blog/tags/${id}`,
      payload,
      // keepEmptyStrings: the edit drawer submits every field, so `''` means
      // "the admin blanked this". Without it BAPI strips the key, the PATCH
      // route reads the field as absent — "leave unchanged" — and the archive
      // intro (or any meta field) could be set but never cleared again.
      { showGlobalError: false, showGlobalSuccess: true, keepEmptyStrings: true }
    )
    return res.data
  },

  async changeActive(id: string, isActive: boolean): Promise<BlogTag> {
    const res = await BAPI.patch<ApiResponse<BlogTag>>(
      `/api/blog/tags/${id}`,
      { isActive },
      { showGlobalError: true, showGlobalSuccess: true }
    )
    return res.data
  },

  async delete(id: string): Promise<void> {
    await BAPI.delete<ApiResponse<null>>(
      `/api/blog/tags/${id}`,
      undefined,
      { showGlobalError: true, showGlobalSuccess: true }
    )
  },
}
