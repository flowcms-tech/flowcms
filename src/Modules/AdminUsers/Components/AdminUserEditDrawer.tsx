'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import ElementDrawer, { ElementDrawerFooter } from '@/components/shared/ElementDrawer/ElementDrawer'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import RoleField from './RoleField'
import { updateAdminUserSchema, type UpdateAdminUserFormValues } from '../Values/Validations'
import { AdminUsersServices } from '../Services/AdminUsersServices'
import { canChangeRole, canDemoteOwner, type Role } from '@/Framework/Auth/permissions'
import type { AdminUser } from '../Types'

interface AdminUserEditDrawerProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  user: AdminUser | null
  onUpdated: () => void
  actorRole: Role
  actorId: string
}

export default function AdminUserEditDrawer({ isOpen, setIsOpen, user, onUpdated, actorRole, actorId }: AdminUserEditDrawerProps) {
  const [serverErrors, setServerErrors] = useState<string[]>([])

  const methods = useForm<UpdateAdminUserFormValues>({
    resolver: zodResolver(updateAdminUserSchema),
    defaultValues: { name: '', email: '', password: '', role: 'contributor' },
  })

  const { handleSubmit, reset, formState: { isSubmitting } } = methods

  useEffect(() => {
    if (user) {
      reset({
        name:     user.name,
        email:    user.email,
        password: '',
        role:     user.role,
      })
    }
  }, [user, reset])

  // Mirrors the two owner rules the route enforces: an admin cannot touch an
  // owner's role at all, and an owner can only be demoted by itself.
  const roleLocked =
    !!user &&
    (!canChangeRole(actorRole, user.role) ||
      (user.role === 'owner' && !canDemoteOwner(actorId, user.id)))

  function handleClose(open: boolean) {
    if (!open) setServerErrors([])
    setIsOpen(open)
  }

  const onSubmit = async (values: UpdateAdminUserFormValues) => {
    if (!user) return
    setServerErrors([])
    try {
      const payload = { ...values, password: values.password ? values.password : undefined }
      await AdminUsersServices.update(user.id, payload)
      onUpdated()
      handleClose(false)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { message?: string | string[] } } }
      if (axiosErr.response?.status === 422) {
        const raw = axiosErr.response.data?.message
        setServerErrors(Array.isArray(raw) ? raw : raw ? [raw] : ['An error occurred'])
      } else {
        setServerErrors(['An error occurred'])
      }
    }
  }

  return (
    <ElementDrawer
      isOpen={isOpen}
      setIsOpen={handleClose}
      headerLabel="Edit Admin User"
      direction="left"
      footer={
        <ElementDrawerFooter>
          <ElementButton variant="cancel" onClick={() => handleClose(false)} disabled={isSubmitting}>
            Cancel
          </ElementButton>
          <ElementButton onClick={handleSubmit(onSubmit)} isLoading={isSubmitting}>
            Save Changes
          </ElementButton>
        </ElementDrawerFooter>
      }
    >
      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <ValidationBox messages={serverErrors} />

          <ElementInput name="name" label="Name" placeholder="Full name" required />
          <ElementInput name="email" type="email" label="Email" placeholder="email@example.com" required />
          <ElementInput name="password" type="password" label="Password" placeholder="Leave blank to keep current password" hint="If left blank, the current password will be kept" />
          <RoleField actorRole={actorRole} currentRole={user?.role} disabled={roleLocked} />
        </form>
      </FormProvider>
    </ElementDrawer>
  )
}
