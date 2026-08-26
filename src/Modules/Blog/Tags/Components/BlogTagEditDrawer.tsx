'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import ElementDrawer, { ElementDrawerFooter } from '@/components/shared/ElementDrawer/ElementDrawer'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementTextArea from '@/components/shared/ElementTextArea/ElementTextArea'
import ElementCheckbox from '@/components/shared/ElementCheckbox/ElementCheckbox'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { updateBlogTagSchema, type UpdateBlogTagFormValues } from '../Values/Validations'
import { ARCHIVE_INTRO_HINT, INDEXABLE_HINT } from '../Values/BlogTagValues'
import { BlogTagServices } from '../Services/BlogTagServices'
import type { BlogTag } from '../Types'

interface BlogTagEditDrawerProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  tag: BlogTag | null
  onUpdated: () => void
}

export default function BlogTagEditDrawer({ isOpen, setIsOpen, tag, onUpdated }: BlogTagEditDrawerProps) {
  const [serverErrors, setServerErrors] = useState<string[]>([])

  const methods = useForm<UpdateBlogTagFormValues>({
    resolver: zodResolver(updateBlogTagSchema),
    defaultValues: {
      name: '', slug: '', metaTitle: '', metaDescription: '', canonicalUrl: '',
      isIndexable: true, archiveIntro: '',
    },
  })

  const { handleSubmit, reset, formState: { isSubmitting } } = methods

  useEffect(() => {
    if (tag) {
      reset({
        name: tag.name,
        slug: tag.slug,
        metaTitle: tag.metaTitle ?? '',
        metaDescription: tag.metaDescription ?? '',
        canonicalUrl: tag.canonicalUrl ?? '',
        isIndexable: tag.isIndexable,
        archiveIntro: tag.archiveIntro ?? '',
      })
    }
  }, [tag, reset])

  function handleClose(open: boolean) {
    if (!open) setServerErrors([])
    setIsOpen(open)
  }

  const onSubmit = async (values: UpdateBlogTagFormValues) => {
    if (!tag) return
    setServerErrors([])
    try {
      await BlogTagServices.update(tag.id, values)
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
      headerLabel="Edit Blog Tag"
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

          <ElementInput name="name" label="Name" placeholder="e.g. Emergency" required />
          <ElementInput name="slug" label="Slug" placeholder="emergency" required hint="Used in the tag URL." />

          <div className="mt-2 border-t pt-4">
            <p className="text-sm font-semibold">SEO</p>
          </div>

          <ElementInput name="metaTitle" label="Meta Title" placeholder="Overrides the page <title> for SEO" maxLength={70} />
          <ElementTextArea name="metaDescription" label="Meta Description" placeholder="Search-engine snippet text" maxLength={160} rows={2} />
          <ElementInput name="canonicalUrl" label="Canonical URL" placeholder="https://flowcms.tech/blog/tag/..." />

          <ElementCheckbox name="isIndexable" label="Allow search engines to index this archive" hint={INDEXABLE_HINT} />
          <ElementTextArea
            name="archiveIntro"
            label="Archive Intro"
            placeholder="A few paragraphs about what this tag covers…"
            hint={ARCHIVE_INTRO_HINT}
            maxLength={2000}
            rows={6}
          />
        </form>
      </FormProvider>
    </ElementDrawer>
  )
}
