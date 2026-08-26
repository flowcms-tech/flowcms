import { z } from 'zod'
import { ROLES } from '@/Framework/Auth/permissions'
import { normalizeEmail } from "@/Framework/Auth/identity"

/**
 * Role is required on create rather than defaulted.
 *
 * The column defaults to "admin" so the migration could not strip rights from
 * accounts that predate roles, but that is the wrong default for a *new*
 * account: silently minting an admin because someone skipped a dropdown is how
 * a permission system ends up meaning nothing. The form preselects
 * "contributor"; the API insists the choice was made.
 */
export const createAdminUserSchema = z.object({
  name:     z.string().min(1, 'Name is required').max(100),
  email:    z.string().min(1, 'Email is required').email('Invalid email').max(100).transform(normalizeEmail),
  password: z.string().min(6, 'Password must be at least 6 characters').max(100),
  role:     z.enum(ROLES, { message: 'Choose a role' }),
})

export const updateAdminUserSchema = z.object({
  name:     z.string().min(1, 'Name is required').max(100),
  email:    z.string().min(1, 'Email is required').email('Invalid email').max(100).transform(normalizeEmail),
  password: z.union([z.string().min(6, 'Password must be at least 6 characters').max(100), z.literal('')]).optional(),
  role:     z.enum(ROLES, { message: 'Choose a role' }),
})

export type CreateAdminUserFormValues = z.infer<typeof createAdminUserSchema>
export type UpdateAdminUserFormValues = z.infer<typeof updateAdminUserSchema>
