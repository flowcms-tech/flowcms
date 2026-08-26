'use client'

import { useForm, FormProvider } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Globe2 } from 'lucide-react'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementTableButton from '@/components/shared/ElementTable/TableActionsButton/ElementTableButton'
import { SiteSettingsServices } from '../../Services/SiteSettingsServices'

interface FormValues {
  twoLetterIsoCountryCode: string
  type: string
  url: string
}

export default function RegionalTab() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['bing-regional'], queryFn: SiteSettingsServices.regional })
  const methods = useForm<FormValues>({ defaultValues: { twoLetterIsoCountryCode: '', type: '0', url: '' } })

  const items = data?.items ?? []

  const onSubmit = async (values: FormValues) => {
    if (!values.twoLetterIsoCountryCode.trim() || !values.url.trim()) return
    const result = await SiteSettingsServices.addRegional({
      twoLetterIsoCountryCode: values.twoLetterIsoCountryCode.trim().toUpperCase(),
      type: Number(values.type),
      url: values.url.trim(),
    })
    queryClient.setQueryData(['bing-regional'], result)
    methods.reset({ twoLetterIsoCountryCode: '', type: values.type, url: '' })
  }

  const handleRemove = async (twoLetterIsoCountryCode: string, type: number, url: string) => {
    const result = await SiteSettingsServices.removeRegional({ twoLetterIsoCountryCode, type, url })
    queryClient.setQueryData(['bing-regional'], result)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Geo-targets a URL or directory to a specific country/region for Bing&apos;s search results.
        The exact meaning of the numeric &quot;Type&quot; field isn&apos;t published by Bing — 0 is
        used here as the default; confirm the right value against a live account before relying on
        this for anything beyond a single test entry.
      </p>

      <FormProvider {...methods}>
        <form onSubmit={methods.handleSubmit(onSubmit)} className="flex flex-wrap items-end gap-2">
          <ElementInput name="twoLetterIsoCountryCode" label="Country code" placeholder="CA" maxLength={2} classNames={{ root: 'w-28' }} />
          <ElementInput name="url" label="URL" placeholder="https://flowcms.tech/" classNames={{ root: 'min-w-[240px] flex-1' }} />
          <ElementInput name="type" label="Type" placeholder="0" classNames={{ root: 'w-20' }} />
          <ElementButton type="submit" size="sm" isLoading={methods.formState.isSubmitting}>
            <Plus size={14} /> Add
          </ElementButton>
        </form>
      </FormProvider>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-8 text-center">
          <Globe2 size={20} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No regional settings configured.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={`${item.url}-${item.twoLetterIsoCountryCode}`} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="truncate">{item.url}</span>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-muted-foreground">{item.twoLetterIsoCountryCode}</span>
                <ElementTableButton.delete title="Remove" onClick={() => handleRemove(item.twoLetterIsoCountryCode, item.type, item.url)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
