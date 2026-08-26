import BAPI from '@/Framework/API_Layer'
import type { BlogCategory, BlogCategoryPayload } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

export const BlogCategoryServices = {
  async list(search?: string): Promise<BlogCategory[]> {
    const res = await BAPI.get<ApiResponse<BlogCategory[]>>(
      '/api/blog/categories',
      { params: search ? { search } : undefined, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async get(id: string): Promise<BlogCategory> {
    const res = await BAPI.get<ApiResponse<BlogCategory>>(
      `/api/blog/categories/${id}`,
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async store(payload: BlogCategoryPayload): Promise<BlogCategory> {
    const res = await BAPI.post<ApiResponse<BlogCategory>>(
      '/api/blog/categories',
      payload,
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async update(id: string, payload: Partial<BlogCategoryPayload> & { isActive?: boolean }): Promise<BlogCategory> {
    const res = await BAPI.patch<ApiResponse<BlogCategory>>(
      `/api/blog/categories/${id}`,
      payload,
      // keepEmptyStrings: the edit drawer submits every field, so `''` means
      // "the admin blanked this". Without it BAPI strips the key, the PATCH
      // route reads the field as absent — "leave unchanged" — and the archive
      // intro (or any meta field) could be set but never cleared again.
      { showGlobalError: false, showGlobalSuccess: true, keepEmptyStrings: true }
    )
    return res.data
  },

  async changeActive(id: string, isActive: boolean): Promise<BlogCategory> {
    const res = await BAPI.patch<ApiResponse<BlogCategory>>(
      `/api/blog/categories/${id}`,
      { isActive },
      { showGlobalError: true, showGlobalSuccess: true }
    )
    return res.data
  },

  async delete(id: string): Promise<void> {
    await BAPI.delete<ApiResponse<null>>(
      `/api/blog/categories/${id}`,
      undefined,
      { showGlobalError: true, showGlobalSuccess: true }
    )
  },
}
