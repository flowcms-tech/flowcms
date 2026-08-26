import BAPI from '@/Framework/API_Layer'
import type { AdminUser, AdminUsersPage, AdminUserPayload } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

export const AdminUsersServices = {
  async list(params?: { search?: string; page?: number }): Promise<AdminUsersPage> {
    const res = await BAPI.get<ApiResponse<AdminUsersPage>>(
      '/api/admin-users',
      { params, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async get(id: string): Promise<AdminUser> {
    const res = await BAPI.get<ApiResponse<AdminUser>>(
      `/api/admin-users/${id}`,
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async store(payload: AdminUserPayload): Promise<AdminUser> {
    const res = await BAPI.post<ApiResponse<AdminUser>>(
      '/api/admin-users',
      payload,
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async update(id: string, payload: AdminUserPayload): Promise<AdminUser> {
    const res = await BAPI.patch<ApiResponse<AdminUser>>(
      `/api/admin-users/${id}`,
      payload,
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async changeActive(id: string, isActive: boolean): Promise<AdminUser> {
    const res = await BAPI.patch<ApiResponse<AdminUser>>(
      `/api/admin-users/${id}`,
      { isActive },
      { showGlobalError: true, showGlobalSuccess: true }
    )
    return res.data
  },

  async delete(id: string): Promise<void> {
    await BAPI.delete<ApiResponse<null>>(
      `/api/admin-users/${id}`,
      undefined,
      { showGlobalError: true, showGlobalSuccess: true }
    )
  },
}
