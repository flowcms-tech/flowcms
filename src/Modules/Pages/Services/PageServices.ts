import BAPI from '@/Framework/API_Layer'
import type { CustomPage, CustomPagePayload } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

export const PageServices = {
  async list(search?: string): Promise<CustomPage[]> {
    const res = await BAPI.get<ApiResponse<CustomPage[]>>(
      '/api/pages',
      { params: search ? { search } : undefined, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async get(id: string): Promise<CustomPage> {
    const res = await BAPI.get<ApiResponse<CustomPage>>(
      `/api/pages/${id}`,
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async store(payload: CustomPagePayload): Promise<CustomPage> {
    const res = await BAPI.post<ApiResponse<CustomPage>>(
      '/api/pages',
      payload,
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async update(id: string, payload: Partial<CustomPagePayload>): Promise<CustomPage> {
    const res = await BAPI.patch<ApiResponse<CustomPage>>(
      `/api/pages/${id}`,
      payload,
      // keepEmptyStrings: the edit form submits every field, so `''` means
      // "the admin blanked this". Without it BAPI strips the key and the
      // PATCH route reads the field as absent — "leave unchanged" — and a
      // meta field could be set but never cleared again.
      { showGlobalError: false, showGlobalSuccess: true, keepEmptyStrings: true }
    )
    return res.data
  },

  async changePublished(id: string, isPublished: boolean): Promise<CustomPage> {
    const res = await BAPI.patch<ApiResponse<CustomPage>>(
      `/api/pages/${id}`,
      { isPublished },
      { showGlobalError: true, showGlobalSuccess: true }
    )
    return res.data
  },

  async delete(id: string): Promise<void> {
    await BAPI.delete<ApiResponse<null>>(
      `/api/pages/${id}`,
      undefined,
      { showGlobalError: true, showGlobalSuccess: true }
    )
  },
}
