'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import ElementDrawer, { ElementDrawerFooter } from '@/components/shared/ElementDrawer/ElementDrawer'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementSelect from '@/components/shared/ElementSelect/ElementSelect'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { createBlogCategorySchema, type CreateBlogCategoryFormValues } from '../Values/Validations'
import { ARCHIVE_INTRO_HINT, INDEXABLE_HINT, buildParentOptions, slugify } from '../Values/BlogCategoryValues'
import { BlogCategoryServices } from '../Services/BlogCategoryServices'
import ElementFileSelector from '@/components/shared/ElementFileSelector/ElementFileSelector'
import ElementTextArea from '@/components/shared/ElementTextArea/ElementTextArea'
import ElementCheckbox from '@/components/shared/ElementCheckbox/ElementCheckbox'
import type { BlogCategory } from '../Types'

interface BlogCategoryCreateDrawerProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  categories: BlogCategory[]
  onCreated: (category: BlogCategory) => void
}

export default function BlogCategoryCreateDrawer({ isOpen, setIsOpen, categories, onCreated }: BlogCategoryCreateDrawerProps) {
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [slugTouched, setSlugTouched] = useState(false)

  const methods = useForm<CreateBlogCategoryFormValues>({
    resolver: zodResolver(createBlogCategorySchema),
    defaultValues: {
      name: '', slug: '', description: '', parentId: '',
      imageKey: null, ogImageKey: null,
      metaTitle: '', metaDescription: '', canonicalUrl: '',
      isIndexable: true, archiveIntro: '',
    },
  })

  const { handleSubmit, reset, watch, setValue, formState: { isSubmitting } } = methods
  const nameValue = watch('name')
  const slugValue = watch('slug')

  // Auto-derive the slug from the name until the admin edits the slug field
  // directly (detected by its value diverging from the auto-derived one).
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

  const onSubmit = async (values: CreateBlogCategoryFormValues) => {
    setServerErrors([])
    try {
      const created = await BlogCategoryServices.store({
        ...values,
        parentId: values.parentId || null,
      })
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

  const parentOptions = buildParentOptions(categories)

  return (
    <ElementDrawer
      isOpen={isOpen}
      setIsOpen={handleClose}
      headerLabel="Create Blog Category"
      direction="left"
      size="md"
      footer={
        <ElementDrawerFooter>
          <ElementButton variant="cancel" onClick={() => handleClose(false)} disabled={isSubmitting}>
            Cancel
          </ElementButton>
          <ElementButton onClick={handleSubmit(onSubmit)} isLoading={isSubmitting}>
            Create Category
          </ElementButton>
        </ElementDrawerFooter>
      }
    >
      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <ValidationBox messages={serverErrors} />

          <ElementInput name="name" label="Name" placeholder="e.g. Product Updates" required />
          <ElementInput
            name="slug"
            label="Slug"
            placeholder="product-updates"
            required
            hint="Used in the category URL. Auto-generated from the name — edit to override."
          />
          <ElementSelect
            name="parentId"
            label="Parent Category"
            placeholder="None (top-level category)"
            items={parentOptions}
            clearable
          />
          <ElementTextArea name="description" label="Description" placeholder="Shown on the category archive page" />

          <ElementFileSelector
            name="imageKey"
            label="Thumbnail Image"
            hint="Shown in category listings."
            accept="image"
          />
          <ElementFileSelector
            name="ogImageKey"
            label="Social Share Image (OG)"
            hint="Shown when this category page is shared on social media."
            accept="image"
          />

          <div className="mt-2 border-t pt-4">
            <p className="text-sm font-semibold">SEO</p>
          </div>

          <ElementInput name="metaTitle" label="Meta Title" placeholder="Overrides the page <title> for SEO" maxLength={70} />
          <ElementTextArea name="metaDescription" label="Meta Description" placeholder="Search-engine snippet text" maxLength={160} rows={2} />
          <ElementInput name="canonicalUrl" label="Canonical URL" placeholder="https://flowcms.tech/blog/category/..." />

          <ElementCheckbox name="isIndexable" label="Allow search engines to index this archive" hint={INDEXABLE_HINT} />
          <ElementTextArea
            name="archiveIntro"
            label="Archive Intro"
            placeholder="A few paragraphs about what this category covers…"
            hint={ARCHIVE_INTRO_HINT}
            maxLength={2000}
            rows={6}
          />
        </form>
      </FormProvider>
    </ElementDrawer>
  )
}
