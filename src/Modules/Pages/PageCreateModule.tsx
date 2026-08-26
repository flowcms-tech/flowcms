'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementTextArea from '@/components/shared/ElementTextArea/ElementTextArea'
import ElementFileSelector from '@/components/shared/ElementFileSelector/ElementFileSelector'
import ElementCheckbox from '@/components/shared/ElementCheckbox/ElementCheckbox'
import ElementEditor from '@/components/shared/ElementEditor/ElementEditor'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { createPageSchema, type CreatePageFormValues } from './Values/Validations'
import { pathFromTitle } from './Values/PageValues'
import { PageServices } from './Services/PageServices'

// Admin-relative; joined with the configured root by adminHref() at use.
const PAGES_LIST_PATH = '/pages'

export default function PageCreateModule() {
  const adminHref = useAdminHref()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [pathTouched, setPathTouched] = useState(false)

  const methods = useForm<CreatePageFormValues>({
    resolver: zodResolver(createPageSchema),
    defaultValues: {
      title: '', path: '', content: '',
      metaTitle: '', metaDescription: '', canonicalUrl: '',
      ogImageKey: '', isIndexable: true,
    },
  })

  const { handleSubmit, watch, setValue, formState: { isSubmitting } } = methods
  const titleValue = watch('title')
  const pathValue = watch('path')

  // Auto-derive the path from the title until the admin edits the path
  // field directly — same detection-by-divergence pattern as blog
  // categories' slug field.
  useEffect(() => {
    if (!pathTouched) setValue('path', pathFromTitle(titleValue || ''), { shouldValidate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleValue])

  useEffect(() => {
    if (pathValue !== pathFromTitle(titleValue || '')) setPathTouched(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathValue])

  const onSubmit = async (values: CreatePageFormValues) => {
    setServerErrors([])
    try {
      const created = await PageServices.store(values)
      await queryClient.invalidateQueries({ queryKey: ['pages-list'] })
      router.push(adminHref(`${PAGES_LIST_PATH}/${created.id}/edit`))
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
          <h1 className="mt-1 text-lg font-semibold">Create Page</h1>
        </div>
        <div className="flex items-center gap-2">
          <ElementButton variant="cancel" onClick={() => router.push(adminHref(PAGES_LIST_PATH))} disabled={isSubmitting}>
            Cancel
          </ElementButton>
          <ElementButton onClick={handleSubmit(onSubmit)} isLoading={isSubmitting}>
            Save as Draft
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
                hint="The page's URL. Auto-generated from the title — edit to override, or nest it (e.g. /legal/terms)."
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
