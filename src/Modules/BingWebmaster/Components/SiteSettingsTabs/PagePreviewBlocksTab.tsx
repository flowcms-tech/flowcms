'use client'

import { useForm, FormProvider } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ImageOff } from 'lucide-react'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementTableButton from '@/components/shared/ElementTable/TableActionsButton/ElementTableButton'
import { SiteSettingsServices } from '../../Services/SiteSettingsServices'

interface FormValues {
  url: string
  reason: string
}

export default function PagePreviewBlocksTab() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['bing-page-preview-blocks'], queryFn: SiteSettingsServices.pagePreviewBlocks })
  const methods = useForm<FormValues>({ defaultValues: { url: '', reason: '' } })

  const items = data?.items ?? []

  const onSubmit = async (values: FormValues) => {
    if (!values.url.trim() || !values.reason.trim()) return
    const result = await SiteSettingsServices.addPagePreviewBlock(values.url.trim(), values.reason.trim())
    queryClient.setQueryData(['bing-page-preview-blocks'], result)
    methods.reset({ url: '', reason: '' })
  }

  const handleRemove = async (url: string) => {
    const result = await SiteSettingsServices.removePagePreviewBlock(url)
    queryClient.setQueryData(['bing-page-preview-blocks'], result)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Blocks Bing from generating a visual page-preview snippet for a URL. Bing&apos;s
        &quot;BlockReason&quot; enum isn&apos;t published — a free-text reason is sent as-is; verify
        with a real submission before relying on a specific value.
      </p>

      <FormProvider {...methods}>
        <form onSubmit={methods.handleSubmit(onSubmit)} className="flex flex-wrap items-end gap-2">
          <ElementInput name="url" label="URL" placeholder="https://flowcms.tech/gallery" classNames={{ root: 'min-w-[240px] flex-1' }} />
          <ElementInput name="reason" label="Reason" placeholder="Copyright" classNames={{ root: 'w-40' }} />
          <ElementButton type="submit" size="sm" isLoading={methods.formState.isSubmitting}>
            <Plus size={14} /> Block
          </ElementButton>
        </form>
      </FormProvider>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-8 text-center">
          <ImageOff size={20} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No page preview blocks configured.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.url} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="truncate">{item.url}</span>
              <div className="flex shrink-0 items-center gap-2">
                {item.reason && <span className="text-xs text-muted-foreground">{item.reason}</span>}
                <ElementTableButton.delete title="Remove" onClick={() => handleRemove(item.url)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
