'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import ElementDrawer, { ElementDrawerFooter } from '@/components/shared/ElementDrawer/ElementDrawer'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import AuthorFormFields from './AuthorFormFields'
import { createAuthorSchema, type CreateAuthorFormValues } from '../Values/Validations'
import { slugify } from '../Values/AuthorValues'
import { AuthorServices } from '../Services/AuthorServices'
import type { Author } from '../Types'

interface AuthorCreateDrawerProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  onCreated: (author: Author) => void
}

const EMPTY: CreateAuthorFormValues = {
  name: '', slug: '', jobTitle: '', credentials: '', bio: '',
  avatarKey: '', avatarAltText: '', email: '',
  websiteUrl: '', linkedinUrl: '', twitterUrl: '', facebookUrl: '', instagramUrl: '',
  metaTitle: '', metaDescription: '', canonicalUrl: '', isIndexable: true,
}

export default function AuthorCreateDrawer({
  isOpen,
  setIsOpen,
  onCreated,
}: AuthorCreateDrawerProps) {
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [slugTouched, setSlugTouched] = useState(false)

  const methods = useForm<CreateAuthorFormValues>({
    resolver: zodResolver(createAuthorSchema),
    defaultValues: EMPTY,
  })

  const { handleSubmit, reset, watch, setValue, formState: { isSubmitting } } = methods
  const nameValue = watch('name')
  const slugValue = watch('slug')

  useEffect(() => {
    if (!slugTouched) setValue('slug', slugify(nameValue || ''), { shouldValidate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameValue])

  useEffect(() => {
    if (slugValue !== slugify(nameValue || '')) setSlugTouched(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugValue])

  function handleClose(open: boolean) {
    if (!open) {
      reset(EMPTY)
      setServerErrors([])
      setSlugTouched(false)
    }
    setIsOpen(open)
  }

  const onSubmit = async (values: CreateAuthorFormValues) => {
    setServerErrors([])
    try {
      const created = await AuthorServices.store(values)
      onCreated(created)
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
      headerLabel="Create Author"
      direction="left"
      size="md"
      footer={
        <ElementDrawerFooter>
          <ElementButton variant="cancel" onClick={() => handleClose(false)} disabled={isSubmitting}>
            Cancel
          </ElementButton>
          <ElementButton onClick={handleSubmit(onSubmit)} isLoading={isSubmitting}>
            Create Author
          </ElementButton>
        </ElementDrawerFooter>
      }
    >
      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <ValidationBox messages={serverErrors} />
          <AuthorFormFields />
        </form>
      </FormProvider>
    </ElementDrawer>
  )
}
