'use client'

import { useForm, FormProvider } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Link2Off } from 'lucide-react'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementTableButton from '@/components/shared/ElementTable/TableActionsButton/ElementTableButton'
import { SiteSettingsServices } from '../../Services/SiteSettingsServices'

interface FormValues {
  market: string
  searchUrl: string
  deepLinkUrl: string
}

export default function DeepLinkBlocksTab() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['bing-deep-link-blocks'], queryFn: SiteSettingsServices.deepLinkBlocks })
  const methods = useForm<FormValues>({ defaultValues: { market: '', searchUrl: '', deepLinkUrl: '' } })

  const items = data?.items ?? []

  const onSubmit = async (values: FormValues) => {
    if (!values.market.trim() || !values.searchUrl.trim() || !values.deepLinkUrl.trim()) return
    const result = await SiteSettingsServices.addDeepLinkBlock({
      market: values.market.trim(),
      searchUrl: values.searchUrl.trim(),
      deepLinkUrl: values.deepLinkUrl.trim(),
    })
    queryClient.setQueryData(['bing-deep-link-blocks'], result)
    methods.reset({ market: '', searchUrl: '', deepLinkUrl: '' })
  }

  const handleRemove = async (market: string, searchUrl: string, deepLinkUrl: string) => {
    const result = await SiteSettingsServices.removeDeepLinkBlock({ market, searchUrl, deepLinkUrl })
    queryClient.setQueryData(['bing-deep-link-blocks'], result)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Prevents a specific deep link from appearing under a search result in a given market (e.g.
        &quot;en-US&quot;).
      </p>

      <FormProvider {...methods}>
        <form onSubmit={methods.handleSubmit(onSubmit)} className="flex flex-wrap items-end gap-2">
          <ElementInput name="market" label="Market" placeholder="en-US" classNames={{ root: 'w-28' }} />
          <ElementInput name="searchUrl" label="Search result URL" placeholder="https://flowcms.tech/" classNames={{ root: 'min-w-[200px] flex-1' }} />
          <ElementInput name="deepLinkUrl" label="Deep link to block" placeholder="https://flowcms.tech/blog" classNames={{ root: 'min-w-[200px] flex-1' }} />
          <ElementButton type="submit" size="sm" isLoading={methods.formState.isSubmitting}>
            <Plus size={14} /> Block
          </ElementButton>
        </form>
      </FormProvider>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-8 text-center">
          <Link2Off size={20} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No deep link blocks configured.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={`${item.market}-${item.searchUrl}-${item.deepLinkUrl}`} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="truncate">{item.deepLinkUrl}</span>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-muted-foreground">{item.market}</span>
                <ElementTableButton.delete title="Remove" onClick={() => handleRemove(item.market, item.searchUrl, item.deepLinkUrl)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
