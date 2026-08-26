'use client'

import { FormProvider, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ValidationBox from '@/components/shared/Validations/ValidationBox'

/**
 * Create a menu for a location, or rename an existing one.
 *
 * One component for both because the only field either needs is the name — the
 * location is chosen by which button was pressed and never becomes a free-text
 * box, which is what keeps an operator from inventing a slot no theme renders.
 */

const schema = z.object({
  name: z.string().trim().min(1, 'A menu name is required').max(120, 'Menu name is too long'),
})

type Values = z.infer<typeof schema>

export default function MenuNameForm({
  title,
  location,
  defaultName,
  submitLabel,
  isSaving,
  serverErrors,
  onSubmit,
  onClose,
}: {
  title: string
  /** Shown as context when creating; omitted when renaming. */
  location?: string
  defaultName?: string
  submitLabel: string
  isSaving: boolean
  serverErrors: string[]
  onSubmit: (values: Values) => void
  onClose: () => void
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: defaultName ?? '' },
  })

  return (
    <ElementModal isOpen title={title} onClose={onClose} size="sm">
      <FormProvider {...form}>
        <form className="flex flex-col gap-3" onSubmit={form.handleSubmit(onSubmit)}>
          {location && (
            <p className="text-sm text-muted-foreground">
              Location: <span className="font-medium">{location}</span>
            </p>
          )}

          <ElementInput name="name" label="Menu name" placeholder="Main navigation" required />

          {serverErrors.length > 0 && <ValidationBox messages={serverErrors} />}

          <div className="flex justify-end gap-2">
            <ElementButton type="button" variant="outline" onClick={onClose}>
              Cancel
            </ElementButton>
            <ElementButton type="submit" isLoading={isSaving}>
              {submitLabel}
            </ElementButton>
          </div>
        </form>
      </FormProvider>
    </ElementModal>
  )
}
