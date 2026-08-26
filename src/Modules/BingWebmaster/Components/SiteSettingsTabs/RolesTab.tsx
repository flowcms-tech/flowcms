'use client'

import { useForm, FormProvider } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Plus, Users } from 'lucide-react'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementCheckbox from '@/components/shared/ElementCheckbox/ElementCheckbox'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ElementTableButton from '@/components/shared/ElementTable/TableActionsButton/ElementTableButton'
import { SiteSettingsServices } from '../../Services/SiteSettingsServices'
import type { SiteRole } from '../../Types/siteSettings'

interface FormValues {
  delegatedUrl: string
  userEmail: string
  authenticationCode: string
  isAdministrator: boolean
  isReadOnly: boolean
}

export default function RolesTab() {
  const queryClient = useQueryClient()
  const [removeTarget, setRemoveTarget] = useState<SiteRole | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)

  const { data, isLoading } = useQuery({ queryKey: ['bing-roles'], queryFn: SiteSettingsServices.roles })
  const methods = useForm<FormValues>({
    defaultValues: { delegatedUrl: '', userEmail: '', authenticationCode: '', isAdministrator: false, isReadOnly: true },
  })

  const items = data?.items ?? []

  const onSubmit = async (values: FormValues) => {
    if (!values.delegatedUrl.trim() || !values.userEmail.trim() || !values.authenticationCode.trim()) return
    const result = await SiteSettingsServices.addRole({
      delegatedUrl: values.delegatedUrl.trim(),
      userEmail: values.userEmail.trim(),
      authenticationCode: values.authenticationCode.trim(),
      isAdministrator: values.isAdministrator,
      isReadOnly: values.isReadOnly,
    })
    queryClient.setQueryData(['bing-roles'], result)
    methods.reset({ delegatedUrl: '', userEmail: '', authenticationCode: '', isAdministrator: false, isReadOnly: true })
  }

  const handleRemove = async () => {
    if (!removeTarget) return
    setIsRemoving(true)
    try {
      const result = await SiteSettingsServices.removeRole(removeTarget)
      queryClient.setQueryData(['bing-roles'], result)
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
        title="Remove access"
        description={removeTarget ? `Remove ${removeTarget.email}'s access to ${removeTarget.site}?` : undefined}
        confirmText="Remove"
        cancelText="Cancel"
        isLoading={isRemoving}
        onConfirm={handleRemove}
      />

      <p className="text-xs text-muted-foreground">
        Delegates access to this site (or a sub-path/subdomain of it) to another Bing Webmaster
        account. The authentication code comes from the other account&apos;s own Bing Webmaster
        Settings → API Access page — this app cannot look it up on their behalf.
      </p>

      <FormProvider {...methods}>
        <form onSubmit={methods.handleSubmit(onSubmit)} className="flex flex-wrap items-end gap-2">
          <ElementInput name="delegatedUrl" label="Delegated URL" placeholder="https://flowcms.tech/blog/" classNames={{ root: 'min-w-[200px] flex-1' }} />
          <ElementInput name="userEmail" label="User email" placeholder="editor@example.com" classNames={{ root: 'min-w-[200px] flex-1' }} />
          <ElementInput name="authenticationCode" label="Auth code" placeholder="From their API Access page" classNames={{ root: 'min-w-[200px] flex-1' }} />
          <ElementCheckbox name="isAdministrator" label="Admin" />
          <ElementCheckbox name="isReadOnly" label="Read-only" />
          <ElementButton type="submit" size="sm" isLoading={methods.formState.isSubmitting}>
            <Plus size={14} /> Grant
          </ElementButton>
        </form>
      </FormProvider>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-8 text-center">
          <Users size={20} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No delegated access configured.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={`${item.email}-${item.site}`} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <div className="flex flex-col">
                <span>{item.email}</span>
                <span className="text-xs text-muted-foreground">{item.site}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {item.expired && <span className="text-xs text-destructive">Expired</span>}
                <ElementTableButton.delete title="Remove" onClick={() => setRemoveTarget(item)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
