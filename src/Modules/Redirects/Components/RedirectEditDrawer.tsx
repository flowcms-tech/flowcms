'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import ElementDrawer, { ElementDrawerFooter } from '@/components/shared/ElementDrawer/ElementDrawer'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementSelect from '@/components/shared/ElementSelect/ElementSelect'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { updateRedirectFormSchema, type UpdateRedirectFormFields } from '../Values/Validations'
import { RedirectServices } from '../Services/RedirectServices'
import type { Redirect } from '../Types'

interface RedirectEditDrawerProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  redirect: Redirect | null
  onUpdated: (redirect: Redirect) => void
}

export default function RedirectEditDrawer({
  isOpen,
  setIsOpen,
  redirect,
  onUpdated,
}: RedirectEditDrawerProps) {
  const [serverErrors, setServerErrors] = useState<string[]>([])

  const methods = useForm<UpdateRedirectFormFields>({
    resolver: zodResolver(updateRedirectFormSchema),
    defaultValues: { toPath: '', statusCode: '301' },
  })

  const { handleSubmit, reset, formState: { isSubmitting } } = methods

  useEffect(() => {
    if (redirect) {
      reset({ toPath: redirect.toPath, statusCode: redirect.statusCode === 302 ? '302' : '301' })
    }
  }, [redirect, reset])

  function handleClose(open: boolean) {
    if (!open) setServerErrors([])
    setIsOpen(open)
  }

  const onSubmit = async (values: UpdateRedirectFormFields) => {
    if (!redirect) return
    setServerErrors([])
    try {
      const updated = await RedirectServices.update(redirect.id, {
        toPath: values.toPath,
        statusCode: Number(values.statusCode),
      })
      onUpdated(updated)
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

  return (
    <ElementDrawer
      isOpen={isOpen}
      setIsOpen={handleClose}
      headerLabel="Edit Redirect"
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

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium leading-none text-muted-foreground">From Path</label>
            <div className="rounded-lg border border-input bg-muted/40 px-3 py-2 font-mono text-sm text-muted-foreground">
              {redirect?.fromPath}
            </div>
            <p className="text-sm text-muted-foreground">
              Not editable — a different From path is really a different redirect. Delete this one
              and create a new one instead.
            </p>
          </div>

          <ElementInput
            name="toPath"
            label="To Path"
            placeholder="/blog/new-post-slug or https://example.com/page"
            required
          />
          <ElementSelect
            name="statusCode"
            label="Type"
            hint="Permanent (301) tells Google the move is final and passes the old URL's ranking signal to the new one — use it unless you genuinely expect to move this back."
            items={[
              { label: 'Permanent (301) — recommended', value: '301' },
              { label: 'Temporary (302)', value: '302' },
            ]}
          />
        </form>
      </FormProvider>
    </ElementDrawer>
  )
}
