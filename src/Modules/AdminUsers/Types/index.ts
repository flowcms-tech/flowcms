import type { Role } from '@/Framework/Auth/permissions'

export interface AdminUser extends Record<string, unknown> {
  id: string
  name: string
  email: string
  isActive: boolean
  /** Editorial capability, separate from `isActive` ("can log in at all"). */
  role: Role
}

export interface AdminUsersPage {
  current_page: number
  data: AdminUser[]
  per_page: number
  total: number
}

export interface AdminUserPayload {
  name: string
  email: string
  password?: string
  role?: Role
}
