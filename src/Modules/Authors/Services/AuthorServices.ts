import BAPI from '@/Framework/API_Layer'
import type { Author, AuthorPayload } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

export const AuthorServices = {
  async list(search?: string): Promise<Author[]> {
    const res = await BAPI.get<ApiResponse<Author[]>>(
      '/api/authors',
      { params: search ? { search } : undefined, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async get(id: string): Promise<Author> {
    const res = await BAPI.get<ApiResponse<Author>>(
      `/api/authors/${id}`,
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async store(payload: AuthorPayload): Promise<Author> {
    const res = await BAPI.post<ApiResponse<Author>>(
      '/api/authors',
      payload,
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async update(id: string, payload: Partial<AuthorPayload> & { isActive?: boolean }): Promise<Author> {
    const res = await BAPI.patch<ApiResponse<Author>>(
      `/api/authors/${id}`,
      payload,
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async changeActive(id: string, isActive: boolean): Promise<Author> {
    const res = await BAPI.patch<ApiResponse<Author>>(
      `/api/authors/${id}`,
      { isActive },
      { showGlobalError: true, showGlobalSuccess: true }
    )
    return res.data
  },

  async delete(id: string): Promise<void> {
    await BAPI.delete<ApiResponse<null>>(
      `/api/authors/${id}`,
      undefined,
      // Deleting an author that still has posts returns 422 with an explanatory
      // message, so the global error toast is the right surface for it.
      { showGlobalError: true, showGlobalSuccess: true }
    )
  },
}
