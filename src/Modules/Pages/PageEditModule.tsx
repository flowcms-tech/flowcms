'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementTextArea from '@/components/shared/ElementTextArea/ElementTextArea'
import ElementFileSelector from '@/components/shared/ElementFileSelector/ElementFileSelector'
import ElementCheckbox from '@/components/shared/ElementCheckbox/ElementCheckbox'
import ElementEditor from '@/components/shared/ElementEditor/ElementEditor'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { updatePageSchema, type UpdatePageFormValues } from './Values/Validations'
import { PageServices } from './Services/PageServices'

// Admin-relative; joined with the configured root by adminHref() at use.
const PAGES_LIST_PATH = '/pages'

interface PageEditModuleProps {
  id: string
}

export default function PageEditModule({ id }: PageEditModuleProps) {
  const adminHref = useAdminHref()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [isTogglingPublished, setIsTogglingPublished] = useState(false)

  const { data: page, isLoading: isPageLoading, refetch } = useQuery({
    queryKey: ['page', id],
    queryFn: () => PageServices.get(id),
  })

  const methods = useForm<UpdatePageFormValues>({
    resolver: zodResolver(updatePageSchema),
    defaultValues: {
      title: '', path: '', content: '',
      metaTitle: '', metaDescription: '', canonicalUrl: '',
      ogImageKey: '', isIndexable: true,
    },
  })

  const { handleSubmit, reset, formState: { isSubmitting } } = methods

  useEffect(() => {
    if (page) {
      reset({
        title: page.title,
        path: page.path,
        content: page.content,
        metaTitle: page.metaTitle ?? '',
        metaDescription: page.metaDescription ?? '',
        canonicalUrl: page.canonicalUrl ?? '',
        ogImageKey: page.ogImageKey ?? '',
        isIndexable: page.isIndexable ?? true,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const onSubmit = async (values: UpdatePageFormValues) => {
    setServerErrors([])
    try {
      await PageServices.update(id, values)
      await queryClient.invalidateQueries({ queryKey: ['page', id] })
      await queryClient.invalidateQueries({ queryKey: ['pages-list'] })
      router.push(adminHref(PAGES_LIST_PATH))
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

  // A deliberately separate action from Save: it only flips the publish
  // flag, never carries pending, unsaved form edits along with it — that
  // ambiguity is exactly what a combined "save and publish" button would
  // introduce.
  async function handleTogglePublished() {
    if (!page) return
    setIsTogglingPublished(true)
    try {
      await PageServices.changePublished(id, !page.isPublished)
      await refetch()
      await queryClient.invalidateQueries({ queryKey: ['pages-list'] })
    } finally {
      setIsTogglingPublished(false)
    }
  }

  if (isPageLoading || !page) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href={adminHref(PAGES_LIST_PATH)}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={14} />
            Back to Pages
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-lg font-semibold">Edit Page</h1>
            <ElementBadge variant={page.isPublished ? 'success' : 'muted'}>
              {page.isPublished ? 'Published' : 'Draft'}
            </ElementBadge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ElementButton variant="cancel" onClick={() => router.push(adminHref(PAGES_LIST_PATH))} disabled={isSubmitting}>
            Cancel
          </ElementButton>
          <ElementButton
            variant="outline"
            onClick={handleTogglePublished}
            isLoading={isTogglingPublished}
          >
            {page.isPublished ? 'Unpublish' : 'Publish'}
          </ElementButton>
          <ElementButton onClick={handleSubmit(onSubmit)} isLoading={isSubmitting}>
            Save
          </ElementButton>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background p-6 shadow-sm">
        <FormProvider {...methods}>
          <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4" noValidate>
            <ValidationBox messages={serverErrors} />

            <div className="w-full grid grid-cols-2 items-start gap-4">
              <ElementInput
                name="title"
                label="Title"
                placeholder="e.g. Privacy Policy"
                hint="Shown as the page heading and in the browser tab."
                required
              />
              <ElementInput
                name="path"
                label="Path"
                placeholder="/privacy-policy"
                hint={
                  page.publishedAt
                    ? "The page's URL. Changing this while published automatically 301-redirects the old path."
                    : "The page's URL."
                }
                required
              />
            </div>

            <ElementEditor
              name="content"
              label="Content"
              placeholder="Write the page content..."
              height={420}
              required
            />

            <div className="mt-2 border-t pt-4">
              <p className="text-sm font-semibold">SEO</p>
            </div>

            <ElementInput name="metaTitle" label="Meta Title" placeholder="Overrides the page <title> for SEO" maxLength={70} />
            <ElementTextArea name="metaDescription" label="Meta Description" placeholder="Search-engine snippet text" maxLength={160} rows={2} />
            <ElementInput name="canonicalUrl" label="Canonical URL" placeholder="https://example.com/privacy-policy" />
            <ElementFileSelector
              name="ogImageKey"
              label="Social Share Image (OG)"
              hint="Shown when this page is shared on social media."
              accept="image"
            />
            <ElementCheckbox name="isIndexable" label="Allow search engines to index this page" />
          </form>
        </FormProvider>
      </div>
    </div>
  )
}
