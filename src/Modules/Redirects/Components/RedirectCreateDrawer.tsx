'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import ElementDrawer, { ElementDrawerFooter } from '@/components/shared/ElementDrawer/ElementDrawer'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementSelect from '@/components/shared/ElementSelect/ElementSelect'
import ElementCheckbox from '@/components/shared/ElementCheckbox/ElementCheckbox'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { createRedirectFormSchema, type CreateRedirectFormFields } from '../Values/Validations'
import { RedirectServices } from '../Services/RedirectServices'
import type { Redirect } from '../Types'

interface RedirectCreateDrawerProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  onCreated: (redirect: Redirect) => void
  /** Set by callers that already know the exact source path — e.g. the
   *  Blog Posts list's per-row "Redirect" action. Locks the From Path field
   *  instead of leaving it free text. */
  initialFromPath?: string
  /** Only meaningful alongside initialFromPath: whether that specific
   *  source is currently a live, published post. Omitted (the generic
   *  Redirects screen, where this isn't knowable up front) always shows the
   *  checkbox; true/false from a known context shows or hides it instead of
   *  asking a question the caller already has the answer to. */
  sourcePostIsLive?: boolean
  headerLabel?: string
}

function buildEmpty(fromPath?: string): CreateRedirectFormFields {
  return { fromPath: fromPath ?? '', toPath: '', statusCode: '301', alsoTrashSourcePost: false }
}

export default function RedirectCreateDrawer({
  isOpen,
  setIsOpen,
  onCreated,
  initialFromPath,
  sourcePostIsLive,
  headerLabel = 'Create Redirect',
}: RedirectCreateDrawerProps) {
  const [serverErrors, setServerErrors] = useState<string[]>([])

  const methods = useForm<CreateRedirectFormFields>({
    resolver: zodResolver(createRedirectFormSchema),
    defaultValues: buildEmpty(initialFromPath),
  })

  const { handleSubmit, reset, register, formState: { isSubmitting } } = methods

  useEffect(() => {
    if (isOpen) reset(buildEmpty(initialFromPath))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialFromPath])

  function handleClose(open: boolean) {
    if (!open) {
      reset(buildEmpty(initialFromPath))
      setServerErrors([])
    }
    setIsOpen(open)
  }

  const showTrashCheckbox = sourcePostIsLive ?? true

  const onSubmit = async (values: CreateRedirectFormFields) => {
    setServerErrors([])
    try {
      const created = await RedirectServices.store({
        fromPath: values.fromPath,
        toPath: values.toPath,
        // Defaulted by the schema, so this is only a type-level "maybe" —
        // defaultValues always seeds a real value by submit time.
        statusCode: Number(values.statusCode ?? '301'),
        alsoTrashSourcePost: values.alsoTrashSourcePost,
      })
      onCreated(created)
      handleClose(false)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { message?: string | string[] } } }
      if (axiosErr.response?.status === 422 || axiosErr.response?.status === 409) {
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
      headerLabel={headerLabel}
      direction="left"
      size="md"
      footer={
        <ElementDrawerFooter>
          <ElementButton variant="cancel" onClick={() => handleClose(false)} disabled={isSubmitting}>
            Cancel
          </ElementButton>
          <ElementButton onClick={handleSubmit(onSubmit)} isLoading={isSubmitting}>
            Create Redirect
          </ElementButton>
        </ElementDrawerFooter>
      }
    >
      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <ValidationBox messages={serverErrors} />

          {initialFromPath ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium leading-none">From Path</label>
              <div className="rounded-lg border border-input bg-muted/40 px-3 py-2 font-mono text-sm text-muted-foreground">
                {initialFromPath}
              </div>
              {/* No visible input to bind a Controller to, but the value
                  still has to reach onSubmit — registered explicitly rather
                  than relying on it surviving via defaultValues alone. */}
              <input type="hidden" {...register('fromPath')} />
            </div>
          ) : (
            <ElementInput
              name="fromPath"
              label="From Path"
              placeholder="/blog/old-post-slug"
              hint="The URL visitors currently hit. Only takes effect once nothing else resolves there — a live post, category, or tag at this exact path always wins."
              required
            />
          )}
          <ElementInput
            name="toPath"
            label="To Path"
            placeholder="/blog/new-post-slug or https://example.com/page"
            hint="Where they land instead. A site path (starting with /) or a full https:// URL to another domain."
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
          {showTrashCheckbox && (
            <ElementCheckbox
              name="alsoTrashSourcePost"
              label={
                initialFromPath
                  ? 'Also move this post to the trash'
                  : 'Also move the source post to the trash'
              }
              hint={
                initialFromPath
                  ? 'This post is currently live at that path — the redirect can\'t take effect until it\'s trashed. Checking this does both in one step.'
                  : "Only needed if the From path is still a live, published post — the redirect can't take effect until that URL is free. Has no effect otherwise."
              }
            />
          )}
        </form>
      </FormProvider>
    </ElementDrawer>
  )
}
