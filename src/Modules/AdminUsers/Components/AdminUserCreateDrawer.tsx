'use client'

import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import ElementDrawer, { ElementDrawerFooter } from '@/components/shared/ElementDrawer/ElementDrawer'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import RoleField from './RoleField'
import { createAdminUserSchema, type CreateAdminUserFormValues } from '../Values/Validations'
import { AdminUsersServices } from '../Services/AdminUsersServices'
import type { Role } from '@/Framework/Auth/permissions'

interface AdminUserCreateDrawerProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  onCreated: () => void
  actorRole: Role
}

export default function AdminUserCreateDrawer({ isOpen, setIsOpen, onCreated, actorRole }: AdminUserCreateDrawerProps) {
  const [serverErrors, setServerErrors] = useState<string[]>([])

  const methods = useForm<CreateAdminUserFormValues>({
    resolver: zodResolver(createAdminUserSchema),
    // Preselected as the least-privileged role. A new account starting at
    // "admin" because nobody touched the dropdown is how a permission system
    // quietly stops meaning anything.
    defaultValues: { name: '', email: '', password: '', role: 'contributor' },
  })

  const { handleSubmit, reset, formState: { isSubmitting } } = methods

  function handleClose(open: boolean) {
    if (!open) {
      reset()
      setServerErrors([])
    }
    setIsOpen(open)
  }

  const onSubmit = async (values: CreateAdminUserFormValues) => {
    setServerErrors([])
    try {
      await AdminUsersServices.store(values)
      onCreated()
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
      headerLabel="Create Admin User"
      direction="left"
      footer={
        <ElementDrawerFooter>
          <ElementButton variant="cancel" onClick={() => handleClose(false)} disabled={isSubmitting}>
            Cancel
          </ElementButton>
          <ElementButton onClick={handleSubmit(onSubmit)} isLoading={isSubmitting}>
            Create User
          </ElementButton>
        </ElementDrawerFooter>
      }
    >
      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <ValidationBox messages={serverErrors} />

          <ElementInput name="name" label="Name" placeholder="Full name" required />
          <ElementInput name="email" type="email" label="Email" placeholder="email@example.com" required />
          <ElementInput name="password" type="password" label="Password" placeholder="Minimum 6 characters" required />
          <RoleField actorRole={actorRole} />
        </form>
      </FormProvider>
    </ElementDrawer>
  )
}
