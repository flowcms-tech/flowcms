'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import ElementDrawer, { ElementDrawerFooter } from '@/components/shared/ElementDrawer/ElementDrawer'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementTextArea from '@/components/shared/ElementTextArea/ElementTextArea'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { updateBlogSeriesSchema, type UpdateBlogSeriesFormValues } from '../Values/Validations'
import { BlogSeriesServices } from '../Services/BlogSeriesServices'
import type { BlogSeries } from '../Types'

interface BlogSeriesEditDrawerProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  series: BlogSeries | null
  onUpdated: () => void
}

export default function BlogSeriesEditDrawer({ isOpen, setIsOpen, series, onUpdated }: BlogSeriesEditDrawerProps) {
  const [serverErrors, setServerErrors] = useState<string[]>([])

  const methods = useForm<UpdateBlogSeriesFormValues>({
    resolver: zodResolver(updateBlogSeriesSchema),
    defaultValues: { name: '', slug: '', description: '' },
  })

  const { handleSubmit, reset, formState: { isSubmitting } } = methods

  useEffect(() => {
    if (series) {
      reset({
        name: series.name,
        slug: series.slug,
        description: series.description ?? '',
      })
    }
  }, [series, reset])

  function handleClose(open: boolean) {
    if (!open) setServerErrors([])
    setIsOpen(open)
  }

  const onSubmit = async (values: UpdateBlogSeriesFormValues) => {
    if (!series) return
    setServerErrors([])
    try {
      await BlogSeriesServices.update(series.id, values)
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
      headerLabel="Edit Series"
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

          <ElementInput name="name" label="Name" placeholder="e.g. Choosing a Lock" required />
          <ElementInput
            name="slug"
            label="Slug"
            placeholder="choosing-a-lock"
            required
            hint="Changing this changes the future series URL. Existing posts keep their own slugs."
          />
          <ElementTextArea
            name="description"
            label="Description"
            placeholder="What this series covers, and who it's for."
            maxLength={500}
            rows={3}
          />

          {series && (
            <p className="text-xs text-muted-foreground">
              {series.postCount === 0
                ? 'No posts are in this series yet — assign them from the post form.'
                : `${series.postCount} post${series.postCount === 1 ? '' : 's'} in this series. Ordering is set per post.`}
            </p>
          )}
        </form>
      </FormProvider>
    </ElementDrawer>
  )
}
