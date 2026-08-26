'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import ElementDrawer, { ElementDrawerFooter } from '@/components/shared/ElementDrawer/ElementDrawer'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementTextArea from '@/components/shared/ElementTextArea/ElementTextArea'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { createBlogSeriesSchema, type CreateBlogSeriesFormValues } from '../Values/Validations'
import { slugify } from '../Values/BlogSeriesValues'
import { BlogSeriesServices } from '../Services/BlogSeriesServices'
import type { BlogSeries } from '../Types'

interface BlogSeriesCreateDrawerProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  onCreated: (series: BlogSeries) => void
}

export default function BlogSeriesCreateDrawer({ isOpen, setIsOpen, onCreated }: BlogSeriesCreateDrawerProps) {
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [slugTouched, setSlugTouched] = useState(false)

  const methods = useForm<CreateBlogSeriesFormValues>({
    resolver: zodResolver(createBlogSeriesSchema),
    defaultValues: { name: '', slug: '', description: '' },
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
      reset()
      setServerErrors([])
      setSlugTouched(false)
    }
    setIsOpen(open)
  }

  const onSubmit = async (values: CreateBlogSeriesFormValues) => {
    setServerErrors([])
    try {
      const created = await BlogSeriesServices.store(values)
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
      headerLabel="Create Series"
      direction="left"
      size="md"
      footer={
        <ElementDrawerFooter>
          <ElementButton variant="cancel" onClick={() => handleClose(false)} disabled={isSubmitting}>
            Cancel
          </ElementButton>
          <ElementButton onClick={handleSubmit(onSubmit)} isLoading={isSubmitting}>
            Create Series
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
            hint="Reserved now so the series URL stays stable if an archive page is added later. Auto-generated from the name — edit to override."
          />
          <ElementTextArea
            name="description"
            label="Description"
            placeholder="What this series covers, and who it's for."
            maxLength={500}
            rows={3}
          />

          <p className="text-xs text-muted-foreground">
            Posts are added to a series from the post form, where each one gets its position in the running order.
          </p>
        </form>
      </FormProvider>
    </ElementDrawer>
  )
}
