'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import ElementDrawer, { ElementDrawerFooter } from '@/components/shared/ElementDrawer/ElementDrawer'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import AuthorFormFields from './AuthorFormFields'
import { updateAuthorSchema, type UpdateAuthorFormValues } from '../Values/Validations'
import { AuthorServices } from '../Services/AuthorServices'
import type { Author } from '../Types'

interface AuthorEditDrawerProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  author: Author | null
  onUpdated: (author: Author) => void
}

export default function AuthorEditDrawer({
  isOpen,
  setIsOpen,
  author,
  onUpdated,
}: AuthorEditDrawerProps) {
  const [serverErrors, setServerErrors] = useState<string[]>([])

  const methods = useForm<UpdateAuthorFormValues>({
    resolver: zodResolver(updateAuthorSchema),
    defaultValues: {},
  })

  const { handleSubmit, reset, formState: { isSubmitting } } = methods

  // No auto-slug regeneration here: this author's URL may already be public,
  // so the slug is a plain editable field — same precedent as the category and
  // tag edit drawers.
  useEffect(() => {
    if (author) {
      reset({
        name: author.name,
        slug: author.slug,
        jobTitle: author.jobTitle ?? '',
        credentials: author.credentials ?? '',
        bio: author.bio ?? '',
        avatarKey: author.avatarKey ?? '',
        avatarAltText: author.avatarAltText ?? '',
        email: author.email ?? '',
        websiteUrl: author.websiteUrl ?? '',
        linkedinUrl: author.linkedinUrl ?? '',
        twitterUrl: author.twitterUrl ?? '',
        facebookUrl: author.facebookUrl ?? '',
        instagramUrl: author.instagramUrl ?? '',
        metaTitle: author.metaTitle ?? '',
        metaDescription: author.metaDescription ?? '',
        canonicalUrl: author.canonicalUrl ?? '',
        isIndexable: author.isIndexable,
      })
    }
  }, [author, reset])

  function handleClose(open: boolean) {
    if (!open) setServerErrors([])
    setIsOpen(open)
  }

  const onSubmit = async (values: UpdateAuthorFormValues) => {
    if (!author) return
    setServerErrors([])
    try {
      const updated = await AuthorServices.update(author.id, values)
      onUpdated(updated)
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
      headerLabel={author ? `Edit ${author.name}` : 'Edit Author'}
      direction="left"
      size="md"
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
          <AuthorFormFields />
        </form>
      </FormProvider>
    </ElementDrawer>
  )
}
