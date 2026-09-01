'use client'

import { useEffect, useState } from 'react'
import { Controller, useFormContext, type Control, type FieldValues, type UseFormReturn } from 'react-hook-form'
import { AnimatePresence, motion } from 'framer-motion'
import { X, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ClassValue } from 'clsx'
import type { FileCategory } from '@/Framework/Functions/FileValidation'
import ElementLabelHint from '@/components/shared/ElementLabelHint/ElementLabelHint'
// Imports a module from a shared component, which inverts the usual direction.
// Deliberate: the picker IS the File Manager, and duplicating it here is what
// let the two drift apart in the first place. `ElementEditor` already reaches
// into the same module for pasted-image uploads.
import FileManagerPickerModal from '@/Modules/FileManager/FileManagerPickerModal'
import FileManagerFileIcon from '@/Modules/FileManager/Components/FileManagerFileIcon'
import { FileManagerServices } from '@/Modules/FileManager/Services/FileManagerServices'
import type { FileManagerItem } from '@/Modules/FileManager/Types'

export interface ElementFileSelectorClassNames {
  root?: ClassValue
  label?: ClassValue
  requiredMark?: ClassValue
  trigger?: ClassValue
  error?: ClassValue
}

export interface ElementFileSelectorProps {
  name?: string
  control?: Control<FieldValues>
  value?: string | string[] | null
  onChange?: (value: string | string[] | null) => void
  label?: string
  placeholder?: string
  hint?: string
  required?: boolean
  disabled?: boolean
  multiple?: boolean
  accept?: FileCategory | FileCategory[]
  errorVariant?: 'default' | 'boxBelow'
  classNames?: ElementFileSelectorClassNames
}

function keyName(key: string): string {
  const trimmed = key.replace(/\/$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed
}

function parentPrefixOf(key: string): string {
  const idx = key.lastIndexOf('/')
  return idx === -1 ? '' : key.slice(0, idx + 1)
}

interface CoreProps {
  value: string | string[] | null | undefined
  onChange: (value: string | string[] | null) => void
  error?: { message?: string }
  label?: string
  placeholder?: string
  hint?: string
  required?: boolean
  disabled?: boolean
  multiple: boolean
  accept?: FileCategory | FileCategory[]
  errorVariant: 'default' | 'boxBelow'
  classNames: ElementFileSelectorClassNames
  name?: string
}

function Core({
  value, onChange, error, label, placeholder, hint, required, disabled,
  multiple, accept, errorVariant, classNames, name,
}: CoreProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [resolvedItems, setResolvedItems] = useState<Record<string, FileManagerItem>>({})

  const keys = multiple ? ((value as string[]) ?? []) : (value ? [value as string] : [])

  useEffect(() => {
    const missing = keys.filter((key) => !resolvedItems[key])
    if (missing.length === 0) return

    const prefixes = Array.from(new Set(missing.map(parentPrefixOf)))
    let cancelled = false

    Promise.all(
      prefixes.map((prefix) =>
        FileManagerServices.listDirectory(prefix)
          .then((listing) => listing.files)
          .catch(() => [] as FileManagerItem[])
      )
    ).then((results) => {
      if (cancelled) return
      setResolvedItems((prev) => {
        const next = { ...prev }
        for (const files of results) {
          for (const file of files) {
            if (missing.includes(file.id)) next[file.id] = file
          }
        }
        return next
      })
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(keys)])

  // Keys are all the picker returns, and all this field stores. Names and
  // thumbnails for display are resolved by the effect above, which already has
  // to do that for keys loaded from the server.
  function handleConfirm(keys: string[]) {
    onChange(multiple ? keys : (keys[0] ?? null))
    setIsModalOpen(false)
  }

  function handleRemove(key: string) {
    if (multiple) {
      onChange(keys.filter((k) => k !== key))
    } else {
      onChange(null)
    }
  }

  function displayFor(key: string): { name: string; thumbnailUrl?: string } {
    const resolved = resolvedItems[key]
    return resolved ? { name: resolved.name, thumbnailUrl: resolved.thumbnailUrl } : { name: keyName(key) }
  }

  const errorKey = name ? `${name}-error` : 'element-file-selector-error'

  return (
    <div className={cn('flex flex-col gap-1.5', classNames.root)}>
      {label && (
        <div className="flex items-center gap-1.5">
          <label className={cn('text-sm font-medium leading-none', error ? 'text-destructive' : 'text-foreground', classNames.label)}>
            {label}
            {required && <span className={cn('mx-0.5 text-destructive', classNames.requiredMark)}>*</span>}
          </label>
          {hint && <ElementLabelHint text={hint} />}
        </div>
      )}

      <div
        className={cn(
          'flex flex-col gap-2 rounded-lg border p-3 transition-colors',
          error ? 'border-destructive' : 'border-input',
          errorVariant === 'boxBelow' && error ? 'rounded-b-none border-b-0' : '',
          classNames.trigger
        )}
      >
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">{placeholder ?? 'No file selected'}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {keys.map((key) => {
              const { name: fileName, thumbnailUrl } = displayFor(key)
              return (
                <div key={key} className="flex items-center gap-2 rounded-md border border-border p-1.5">
                  <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                    {thumbnailUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={thumbnailUrl} alt={fileName} className="size-full object-cover" />
                      : <FileManagerFileIcon name={fileName} size={16} className="text-muted-foreground" />}
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm">{fileName}</span>
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => handleRemove(key)}
                      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <button
          type="button"
          disabled={disabled}
          onClick={() => setIsModalOpen(true)}
          className="flex items-center justify-center gap-2 self-start rounded-md border border-input px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
        >
          <FolderOpen size={14} />
          {multiple ? 'Select Files' : keys.length > 0 ? 'Change File' : 'Select File'}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {errorVariant !== 'boxBelow' && error && (
          <motion.p
            key={errorKey}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={cn('text-xs text-destructive', classNames.error)}
            role="alert"
          >
            {error.message}
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {errorVariant === 'boxBelow' && error && (
          <motion.div
            key={`${errorKey}-box`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className={cn('rounded-b-lg border border-t-0 border-destructive px-3 py-2 text-xs text-destructive', classNames.error)}>
              {error.message}
            </div>
          </motion.div>
        )}
      </AnimatePresence>


      <FileManagerPickerModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        multiple={multiple}
        accept={accept}
        onConfirm={handleConfirm}
      />
    </div>
  )
}

export default function ElementFileSelector({
  name,
  control: controlProp,
  value: valueProp,
  onChange: onChangeProp,
  label,
  placeholder,
  hint,
  required = false,
  disabled = false,
  multiple = false,
  accept,
  errorVariant = 'default',
  classNames = {},
}: ElementFileSelectorProps) {
  const formCtx = useFormContext() as UseFormReturn | null
  const effectiveControl = controlProp ?? formCtx?.control

  if (name && effectiveControl) {
    return (
      <Controller
        name={name}
        control={effectiveControl}
        render={({ field, fieldState: { error } }) => (
          <Core
            name={name}
            value={field.value}
            onChange={field.onChange}
            error={error}
            label={label}
            placeholder={placeholder}
            hint={hint}
            required={required}
            disabled={disabled}
            multiple={multiple}
            accept={accept}
            errorVariant={errorVariant}
            classNames={classNames}
          />
        )}
      />
    )
  }

  return (
    <Core
      name={name}
      value={valueProp}
      onChange={(v) => onChangeProp?.(v)}
      label={label}
      placeholder={placeholder}
      hint={hint}
      required={required}
      disabled={disabled}
      multiple={multiple}
      accept={accept}
      errorVariant={errorVariant}
      classNames={classNames}
    />
  )
}

// Kept as an alias so any consumer that imported the old name still compiles.
// `FileManagerItem` is now the single definition of a stored object.
export type { FileManagerItem as FileSelectorItem }
