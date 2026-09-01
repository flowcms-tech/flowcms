'use client'

import { useId, useMemo, useState } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FolderInput } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import { getFileExtension } from '@/Framework/Functions/FileValidation'
import FileManagerDirectoryPicker from './FileManagerDirectoryPicker'
import { parentPrefixOf } from '../Values/FileManagerFormat'
import type { FileManagerItem } from '../Types'

/**
 * Convert one image into another format, as a new file.
 *
 * The dialog is shaped by what the route refuses. It can only ever ADD a file —
 * the original is left alone — so the two ways a conversion could still destroy
 * something are settled here, before the request: the name is editable so it
 * can be moved off a collision, and the destination is selectable so the result
 * can land somewhere else entirely. Leaving both alone converts beside the
 * original, which is the common case.
 */

export type ConvertFormat = 'png' | 'jpg' | 'webp' | 'avif'

/**
 * Two allowed image formats are missing here, for different reasons.
 *
 * SVG cannot be produced at all — nothing reconstructs a vector description
 * from pixels. GIF can be (the encoder writes a valid one), and is left out on
 * purpose: 256 colours and a single frame make it a worse result than every
 * other option for anything a CMS stores.
 */
const FORMATS: { value: ConvertFormat; label: string; hint: string }[] = [
  { value: 'webp', label: 'WebP', hint: 'Smaller, keeps transparency' },
  { value: 'avif', label: 'AVIF', hint: 'Smallest, newer format' },
  { value: 'png', label: 'PNG', hint: 'Lossless, keeps transparency' },
  { value: 'jpg', label: 'JPG', hint: 'No transparency' },
]

interface ConvertFormValues {
  name: string
}

export default function FileManagerConvertModal({
  file,
  isSubmitting = false,
  onSubmit,
  onClose,
}: {
  file: FileManagerItem
  isSubmitting?: boolean
  onSubmit: (input: { format: ConvertFormat; name: string; destination: string }) => void
  onClose: () => void
}) {
  const formId = useId()
  const sourcePrefix = parentPrefixOf(file.id)

  /**
   * The format the file already is, offered to nobody.
   *
   * Quality is fixed, so converting a format to itself has no outcome worth
   * having: PNG to PNG is byte-for-byte the same image, and the lossy formats
   * would re-encode and lose a little each time. It is also the only way to
   * land on the source's own key and be refused by the route — so removing the
   * option removes the dead end rather than explaining it.
   *
   * `.jpeg` and `.jpg` are one format wearing two extensions.
   */
  const sourceFormat = getFileExtension(file.name).replace(/^jpeg$/, 'jpg')

  const [format, setFormat] = useState<ConvertFormat>(
    () => (FORMATS.find((option) => option.value !== sourceFormat) ?? FORMATS[0]).value
  )
  const [destination, setDestination] = useState(sourcePrefix)
  const [isPickingFolder, setIsPickingFolder] = useState(false)

  const schema = useMemo(
    () => z.object({ name: z.string().trim().min(1, 'A file name is required') }),
    []
  )

  const form = useForm<ConvertFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: file.name.replace(/\.[^.]+$/, '') },
  })

  return (
    <ElementModal
      isOpen
      onClose={(open) => { if (!open) onClose() }}
      title="Convert Image"
      size="sm"
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        form.setFocus('name', { shouldSelect: true })
      }}
      footer={
        <ElementModal.Footer>
          <ElementButton type="button" variant="cancel" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </ElementButton>
          <ElementButton type="submit" form={formId} isLoading={isSubmitting}>
            Convert
          </ElementButton>
        </ElementModal.Footer>
      }
    >
      <FormProvider {...form}>
        <form
          id={formId}
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((values) =>
            onSubmit({ format, name: values.name, destination })
          )}
        >
          <p className="text-sm text-muted-foreground">
            Converting <span className="font-medium text-foreground">{file.name}</span>. The
            original is kept.
          </p>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium leading-none">Convert to</span>
            <div className="grid grid-cols-2 gap-2">
              {FORMATS.map((option) => {
                const isSource = option.value === sourceFormat
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={isSource}
                    onClick={() => setFormat(option.value)}
                    className={`flex flex-col items-start rounded-lg border p-2.5 text-start transition-colors ${
                      format === option.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border'
                    } ${
                      isSource
                        ? 'cursor-not-allowed opacity-50'
                        : format === option.value
                          ? ''
                          : 'hover:bg-muted/50'
                    }`}
                  >
                    <span className="text-sm font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {isSource ? 'Already this format' : option.hint}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <ElementInput
            name="name"
            label="Save as"
            placeholder="File name"
            disabled={isSubmitting}
            endContent={
              <span className="flex select-none items-center self-stretch bg-muted/50 px-3 text-sm text-muted-foreground">
                .{format}
              </span>
            }
          />

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium leading-none">Destination</span>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate rounded-lg border border-input px-2.5 py-1.5 text-sm">
                {destination
                  ? destination.replace(/\/$/, '')
                  : 'Home'}
                {destination === sourcePrefix && (
                  <span className="text-muted-foreground"> (beside the original)</span>
                )}
              </span>
              <ElementButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsPickingFolder(true)}
                disabled={isSubmitting}
              >
                <FolderInput size={14} />
                Change
              </ElementButton>
            </div>
          </div>

        </form>
      </FormProvider>

      <FileManagerDirectoryPicker
        isOpen={isPickingFolder}
        title="Convert Into"
        confirmText="Choose"
        isSubmitting={false}
        onClose={() => setIsPickingFolder(false)}
        onConfirm={(prefix) => {
          setDestination(prefix)
          setIsPickingFolder(false)
        }}
      />
    </ElementModal>
  )
}
