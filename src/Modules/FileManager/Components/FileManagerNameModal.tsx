'use client'

import { useId, useMemo } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementModal from '@/components/shared/ElementModal/ElementModal'

/**
 * The one dialog behind every name the File Manager asks for: create a
 * directory, rename a directory, rename a file.
 *
 * All three were `ElementModal.Confirm` wrapping a bare `ui/input` — a
 * confirmation dialog pressed into service as a form. It put a warning triangle
 * beside "Rename File", it offered no way out but its own buttons, the bare
 * input's focus halo read as a stray second border, and a name it refused was
 * reported by a toast in the corner rather than under the field that caused it.
 *
 * MOUNTED ONLY WHILE OPEN, like `MenuNameForm`. The form then initialises with
 * the name it is editing, which is what lets that name be selected the moment
 * the dialog appears — a version that stayed mounted and reset on open put the
 * selection on the previous name and lost it on the next render.
 */

interface FileManagerNameModalProps {
  title: string
  /** Context line above the field — which file, which parent directory. */
  description?: string
  label: string
  placeholder?: string
  /** Pre-fills the field; the whole value starts selected. */
  defaultValue?: string
  /**
   * A tail the field cannot edit, shown as a locked cell at the end of it and
   * appended back on submit — a file's extension, which decides both the
   * allowlist verdict and the Content-Type it is later served with, and so is
   * not a thing to change by retyping the name.
   */
  suffix?: string
  confirmText: string
  isSubmitting?: boolean
  /** Receives the trimmed name, suffix included. */
  onSubmit: (value: string) => void
  onClose: () => void
}

interface NameFormValues {
  name: string
}

export default function FileManagerNameModal({
  title,
  description,
  label,
  placeholder,
  defaultValue = '',
  suffix,
  confirmText,
  isSubmitting = false,
  onSubmit,
  onClose,
}: FileManagerNameModalProps) {
  const formId = useId()

  const schema = useMemo(
    () => z.object({ name: z.string().trim().min(1, `${label} is required`) }),
    [label]
  )

  const form = useForm<NameFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: defaultValue },
  })

  return (
    <ElementModal
      isOpen
      onClose={(open) => { if (!open) onClose() }}
      title={title}
      size="sm"
      onOpenAutoFocus={(event) => {
        // Radix would focus the close button; the name belongs in the field,
        // selected, so that typing replaces it.
        event.preventDefault()
        form.setFocus('name', { shouldSelect: true })
      }}
      footer={
        <ElementModal.Footer>
          <ElementButton type="button" variant="cancel" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </ElementButton>
          {/*
            The footer sits outside the scroll area, and so outside the form.
            `form` re-attaches it, which is what keeps this button and the Enter
            key going through the same validation.
          */}
          <ElementButton type="submit" form={formId} isLoading={isSubmitting}>
            {confirmText}
          </ElementButton>
        </ElementModal.Footer>
      }
    >
      <FormProvider {...form}>
        <form
          id={formId}
          className="flex flex-col gap-3"
          onSubmit={form.handleSubmit((values) => onSubmit(values.name + (suffix ?? '')))}
        >
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
          <ElementInput
            name="name"
            label={label}
            placeholder={placeholder}
            disabled={isSubmitting}
            endContent={
              suffix ? (
                // `self-stretch` so the cell fills the field's height rather
                // than painting a floating pill inside it.
                <span className="flex select-none items-center self-stretch bg-muted/50 px-3 text-sm text-muted-foreground">
                  {suffix}
                </span>
              ) : undefined
            }
          />
        </form>
      </FormProvider>
    </ElementModal>
  )
}
