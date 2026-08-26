'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import ElementDrawer, { ElementDrawerFooter } from '@/components/shared/ElementDrawer/ElementDrawer'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementSelect from '@/components/shared/ElementSelect/ElementSelect'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { updateBlogCategorySchema, type UpdateBlogCategoryFormValues } from '../Values/Validations'
import { ARCHIVE_INTRO_HINT, INDEXABLE_HINT, buildParentOptions } from '../Values/BlogCategoryValues'
import { BlogCategoryServices } from '../Services/BlogCategoryServices'
import ElementFileSelector from '@/components/shared/ElementFileSelector/ElementFileSelector'
import ElementTextArea from '@/components/shared/ElementTextArea/ElementTextArea'
import ElementCheckbox from '@/components/shared/ElementCheckbox/ElementCheckbox'
import type { BlogCategory } from '../Types'

interface BlogCategoryEditDrawerProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  category: BlogCategory | null
  categories: BlogCategory[]
  onUpdated: () => void
}

export default function BlogCategoryEditDrawer({ isOpen, setIsOpen, category, categories, onUpdated }: BlogCategoryEditDrawerProps) {
  const [serverErrors, setServerErrors] = useState<string[]>([])

  const methods = useForm<UpdateBlogCategoryFormValues>({
    resolver: zodResolver(updateBlogCategorySchema),
    defaultValues: {
      name: '', slug: '', description: '', parentId: '',
      imageKey: null, ogImageKey: null,
      metaTitle: '', metaDescription: '', canonicalUrl: '',
      isIndexable: true, archiveIntro: '',
    },
  })

  const { handleSubmit, reset, formState: { isSubmitting } } = methods

  useEffect(() => {
    if (category) {
      reset({
        name: category.name,
        slug: category.slug,
        description: category.description ?? '',
        parentId: category.parentId ?? '',
        imageKey: category.imageKey,
        ogImageKey: category.ogImageKey,
        metaTitle: category.metaTitle ?? '',
        metaDescription: category.metaDescription ?? '',
        canonicalUrl: category.canonicalUrl ?? '',
        isIndexable: category.isIndexable,
        archiveIntro: category.archiveIntro ?? '',
      })
    }
  }, [category, reset])

  function handleClose(open: boolean) {
    if (!open) setServerErrors([])
    setIsOpen(open)
  }

  const onSubmit = async (values: UpdateBlogCategoryFormValues) => {
    if (!category) return
    setServerErrors([])
    try {
      await BlogCategoryServices.update(category.id, {
        ...values,
        parentId: values.parentId || null,
      })
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

  const parentOptions = buildParentOptions(categories, category?.id)

  return (
    <ElementDrawer
      isOpen={isOpen}
      setIsOpen={handleClose}
      headerLabel="Edit Blog Category"
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

          <ElementInput name="name" label="Name" placeholder="e.g. Product Updates" required />
          <ElementInput name="slug" label="Slug" placeholder="product-updates" required hint="Used in the category URL." />
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
