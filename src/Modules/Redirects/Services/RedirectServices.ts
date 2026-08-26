import BAPI from '@/Framework/API_Layer'
import type { Redirect, RedirectPayload } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

export const RedirectServices = {
  async list(search?: string): Promise<Redirect[]> {
    const res = await BAPI.get<ApiResponse<Redirect[]>>(
      '/api/redirects',
      { params: search ? { search } : undefined, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async store(payload: RedirectPayload): Promise<Redirect> {
    const res = await BAPI.post<ApiResponse<Redirect>>(
      '/api/redirects',
      payload,
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async update(id: string, payload: { toPath: string; statusCode: number }): Promise<Redirect> {
    const res = await BAPI.patch<ApiResponse<Redirect>>(
      `/api/redirects/${id}`,
      payload,
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async delete(id: string): Promise<void> {
    await BAPI.delete<ApiResponse<null>>(
      `/api/redirects/${id}`,
      undefined,
      { showGlobalError: true, showGlobalSuccess: true }
    )
  },
}
