'use client'

import { useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, TriangleAlert } from 'lucide-react'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import { SiteSettingsServices } from '../../Services/SiteSettingsServices'

interface FormValues {
  moveScope: string
  moveType: string
  sourceUrl: string
  targetUrl: string
}

export default function SiteMovesTab() {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<FormValues | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { data, isLoading } = useQuery({ queryKey: ['bing-site-moves'], queryFn: SiteSettingsServices.siteMoves })
  const methods = useForm<FormValues>({ defaultValues: { moveScope: '0', moveType: '0', sourceUrl: '', targetUrl: '' } })

  const items = data?.items ?? []

  const onSubmit = (values: FormValues) => {
    if (!values.sourceUrl.trim() || !values.targetUrl.trim()) return
    setPending(values)
  }

  const handleConfirm = async () => {
    if (!pending) return
    setIsSubmitting(true)
    try {
      const result = await SiteSettingsServices.submitSiteMove({
        moveScope: Number(pending.moveScope),
        moveType: Number(pending.moveType),
        sourceUrl: pending.sourceUrl.trim(),
        targetUrl: pending.targetUrl.trim(),
      })
      queryClient.setQueryData(['bing-site-moves'], result)
      methods.reset({ moveScope: pending.moveScope, moveType: pending.moveType, sourceUrl: '', targetUrl: '' })
      setPending(null)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ElementModal.Confirm
        isOpen={pending !== null}
        onClose={(v) => { if (!v) setPending(null) }}
        variant="danger"
        title="Submit site move"
        description={
          pending
            ? `This tells Bing "${pending.sourceUrl}" has permanently moved to "${pending.targetUrl}" — a real, consequential account action with no documented undo. Continue?`
            : undefined
        }
        confirmText="Submit move"
        cancelText="Cancel"
        isLoading={isSubmitting}
        onConfirm={handleConfirm}
      />

      <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground">
        <TriangleAlert size={14} className="mt-0.5 shrink-0" />
        <p>
          Site moves tell Bing your site has permanently relocated. This is not for routine testing
          — Bing gives no documented way to undo one. `MoveScope`/`MoveType`&apos;s exact numeric
          meanings aren&apos;t published; confirm the right values with Bing support or a test
          account before submitting a real move.
        </p>
      </div>

      <FormProvider {...methods}>
        <form onSubmit={methods.handleSubmit(onSubmit)} className="flex flex-wrap items-end gap-2">
          <ElementInput name="sourceUrl" label="From" placeholder="https://old-domain.com/" classNames={{ root: 'min-w-[200px] flex-1' }} />
          <ElementInput name="targetUrl" label="To" placeholder="https://flowcms.tech/" classNames={{ root: 'min-w-[200px] flex-1' }} />
          <ElementInput name="moveScope" label="Scope" placeholder="0" classNames={{ root: 'w-20' }} />
          <ElementInput name="moveType" label="Type" placeholder="0" classNames={{ root: 'w-20' }} />
          <ElementButton type="submit" size="sm" variant="destructive">
            <ArrowRightLeft size={14} /> Submit move
          </ElementButton>
        </form>
      </FormProvider>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No site moves on record.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item, i) => (
            <li key={`${item.sourceUrl}-${item.targetUrl}-${i}`} className="rounded-lg border border-border px-3 py-2 text-sm">
              <span className="truncate">{item.sourceUrl}</span>
              <span className="mx-2 text-muted-foreground">→</span>
              <span className="truncate">{item.targetUrl}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
