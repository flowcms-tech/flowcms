'use client'

import { useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Ban } from 'lucide-react'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementSelect from '@/components/shared/ElementSelect/ElementSelect'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ElementTableButton from '@/components/shared/ElementTable/TableActionsButton/ElementTableButton'
import { SiteSettingsServices } from '../../Services/SiteSettingsServices'
import { BLOCKED_URL_ENTITY_TYPE, BLOCKED_URL_REQUEST_TYPE, type BlockedUrl } from '../../Types/siteSettings'

interface FormValues {
  url: string
  entityType: string
  requestType: string
}

const ENTITY_OPTIONS = [
  { label: 'Page', value: String(BLOCKED_URL_ENTITY_TYPE.page) },
  { label: 'Directory', value: String(BLOCKED_URL_ENTITY_TYPE.directory) },
]

const REQUEST_OPTIONS = [
  { label: 'Cache only', value: String(BLOCKED_URL_REQUEST_TYPE.cacheOnly) },
  { label: 'Full removal', value: String(BLOCKED_URL_REQUEST_TYPE.fullRemoval) },
]

export default function BlockedUrlsTab() {
  const queryClient = useQueryClient()
  const [removeTarget, setRemoveTarget] = useState<BlockedUrl | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)

  const { data, isLoading } = useQuery({ queryKey: ['bing-blocked-urls'], queryFn: SiteSettingsServices.blockedUrls })
  const methods = useForm<FormValues>({
    defaultValues: { url: '', entityType: String(BLOCKED_URL_ENTITY_TYPE.page), requestType: String(BLOCKED_URL_REQUEST_TYPE.cacheOnly) },
  })

  const items = data?.items ?? []

  const onSubmit = async (values: FormValues) => {
    if (!values.url.trim()) return
    const result = await SiteSettingsServices.addBlockedUrl({
      url: values.url.trim(),
      entityType: Number(values.entityType),
      requestType: Number(values.requestType),
    })
    queryClient.setQueryData(['bing-blocked-urls'], result)
    methods.reset({ url: '', entityType: values.entityType, requestType: values.requestType })
  }

  const handleRemove = async () => {
    if (!removeTarget) return
    setIsRemoving(true)
    try {
      const result = await SiteSettingsServices.removeBlockedUrl({
        url: removeTarget.url,
        entityType: removeTarget.entityType,
        requestType: removeTarget.requestType,
      })
      queryClient.setQueryData(['bing-blocked-urls'], result)
      setRemoveTarget(null)
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ElementModal.Confirm
        isOpen={removeTarget !== null}
        onClose={(v) => { if (!v) setRemoveTarget(null) }}
        variant="danger"
        title="Unblock URL"
        description={removeTarget ? `Unblock "${removeTarget.url}" on Bing?` : undefined}
        confirmText="Unblock"
        cancelText="Cancel"
        isLoading={isRemoving}
        onConfirm={handleRemove}
      />

      <FormProvider {...methods}>
        <form onSubmit={methods.handleSubmit(onSubmit)} className="flex flex-wrap items-end gap-2">
          <ElementInput name="url" label="URL" placeholder="https://flowcms.tech/admin/" classNames={{ root: 'min-w-[240px] flex-1' }} />
          <ElementSelect name="entityType" label="Type" items={ENTITY_OPTIONS} classNames={{ root: 'w-36' }} />
          <ElementSelect name="requestType" label="Removal" items={REQUEST_OPTIONS} classNames={{ root: 'w-36' }} />
          <ElementButton type="submit" size="sm" isLoading={methods.formState.isSubmitting}>
            <Plus size={14} /> Block
          </ElementButton>
        </form>
      </FormProvider>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-8 text-center">
          <Ban size={20} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No blocked URLs.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={`${item.url}-${item.entityType}-${item.requestType}`} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="truncate">{item.url}</span>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {item.entityType === BLOCKED_URL_ENTITY_TYPE.directory ? 'Directory' : 'Page'} ·{' '}
                  {item.requestType === BLOCKED_URL_REQUEST_TYPE.fullRemoval ? 'Full removal' : 'Cache only'}
                </span>
                <ElementTableButton.delete title="Unblock" onClick={() => setRemoveTarget(item)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
