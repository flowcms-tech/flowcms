'use client'

import { useForm, FormProvider } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ListFilter } from 'lucide-react'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementCheckbox from '@/components/shared/ElementCheckbox/ElementCheckbox'
import ElementTableButton from '@/components/shared/ElementTable/TableActionsButton/ElementTableButton'
import { SiteSettingsServices } from '../../Services/SiteSettingsServices'

interface FormValues {
  queryParameter: string
}

export default function QueryParamsTab() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['bing-query-params'], queryFn: SiteSettingsServices.queryParams })
  const methods = useForm<FormValues>({ defaultValues: { queryParameter: '' } })

  const items = data?.items ?? []

  const onSubmit = async (values: FormValues) => {
    if (!values.queryParameter.trim()) return
    const result = await SiteSettingsServices.addQueryParam(values.queryParameter.trim())
    queryClient.setQueryData(['bing-query-params'], result)
    methods.reset({ queryParameter: '' })
  }

  const handleToggle = async (parameter: string, isEnabled: boolean) => {
    const result = await SiteSettingsServices.toggleQueryParam(parameter, isEnabled)
    queryClient.setQueryData(['bing-query-params'], result)
  }

  const handleRemove = async (parameter: string) => {
    const result = await SiteSettingsServices.removeQueryParam(parameter)
    queryClient.setQueryData(['bing-query-params'], result)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        URL normalization parameters — Bing ignores these query-string parameters when deciding
        whether two URLs are the same page. Unreserved letters and &quot;:&quot; only.
      </p>

      <FormProvider {...methods}>
        <form onSubmit={methods.handleSubmit(onSubmit)} className="flex flex-wrap items-end gap-2">
          <ElementInput name="queryParameter" label="Parameter" placeholder="utm_source" classNames={{ root: 'min-w-[200px] flex-1' }} />
          <ElementButton type="submit" size="sm" isLoading={methods.formState.isSubmitting}>
            <Plus size={14} /> Add
          </ElementButton>
        </form>
      </FormProvider>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-8 text-center">
          <ListFilter size={20} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No normalization parameters configured.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.parameter} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="truncate font-mono text-xs">{item.parameter}</span>
              <div className="flex shrink-0 items-center gap-3">
                <ElementCheckbox
                  value={item.isEnabled}
                  onChange={(checked) => handleToggle(item.parameter, checked)}
                  label={item.isEnabled ? 'Enabled' : 'Disabled'}
                />
                <ElementTableButton.delete title="Remove" onClick={() => handleRemove(item.parameter)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
