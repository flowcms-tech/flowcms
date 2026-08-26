'use client'

import { Controller, useFormContext, type Control, type FieldValues, type UseFormReturn } from 'react-hook-form'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { ClassValue } from 'clsx'
import ElementLabelHint from '@/components/shared/ElementLabelHint/ElementLabelHint'

export interface ElementTextAreaClassNames {
  root?: ClassValue
  label?: ClassValue
  requiredMark?: ClassValue
  textarea?: ClassValue
  error?: ClassValue
  hint?: ClassValue
}

export interface ElementTextAreaProps {
  name?: string
  control?: Control<FieldValues>
  value?: string
  onChange?: (value: string) => void
  label?: string
  placeholder?: string
  hint?: string
  required?: boolean
  disabled?: boolean
  rows?: number
  maxLength?: number
  errorVariant?: 'default' | 'boxBelow'
  classNames?: ElementTextAreaClassNames
}

interface CoreProps {
  name?: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  error?: { message?: string }
  label?: string
  placeholder?: string
  hint?: string
  required?: boolean
  disabled?: boolean
  rows: number
  maxLength?: number
  errorVariant: 'default' | 'boxBelow'
  classNames: ElementTextAreaClassNames
}

function Core({
  name, value, onChange, onBlur, error, label, placeholder, hint, required, disabled,
  rows, maxLength, errorVariant, classNames,
}: CoreProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', classNames.root)}>
      {label && (
        <div className="flex items-center gap-1.5">
          <label
            htmlFor={name}
            className={cn(
              'text-sm font-medium leading-none',
              error ? 'text-destructive' : 'text-foreground',
              disabled && 'opacity-50 cursor-not-allowed',
              classNames.label
            )}
          >
            {label}
            {required && <span className={cn('mx-0.5 text-destructive', classNames.requiredMark)}>*</span>}
          </label>
          {hint && <ElementLabelHint id={`${name}-hint`} text={hint} />}
        </div>
      )}

      <textarea
        id={name}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={!!error}
        aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
        className={cn(
          'w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary disabled:cursor-not-allowed disabled:opacity-50',
          error ? 'border-destructive' : 'border-input',
          errorVariant === 'boxBelow' && error && 'rounded-b-none border-b-0',
          classNames.textarea
        )}
      />

      <AnimatePresence initial={false}>
        {errorVariant === 'boxBelow' && error && (
          <motion.div
            id={`${name}-error`}
            role="alert"
            key="box-error"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div
              className={cn(
                'rounded-b-lg border border-t-0 border-destructive bg-destructive/5 px-2.5 py-2 text-sm text-destructive',
                classNames.error
              )}
            >
              {error.message}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {errorVariant === 'default' && error && (
          <motion.p
            id={`${name}-error`}
            role="alert"
            key="default-error"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={cn('text-sm text-destructive', classNames.error)}
          >
            {error.message}
          </motion.p>
        )}
      </AnimatePresence>

    </div>
  )
}

export default function ElementTextArea({
  name,
  control: controlProp,
  value: valueProp,
  onChange: onChangeProp,
  label,
  placeholder,
  hint,
  required = false,
  disabled = false,
  rows = 3,
  maxLength,
  errorVariant = 'default',
  classNames = {},
}: ElementTextAreaProps) {
  const formCtx = useFormContext() as UseFormReturn | null
  const effectiveControl = controlProp ?? formCtx?.control

  if (name && effectiveControl) {
    return (
      <Controller
        name={name}
        control={effectiveControl}
        defaultValue=""
        render={({ field, fieldState: { error } }) => (
          <Core
            name={name}
            value={field.value ?? ''}
            onChange={field.onChange}
            onBlur={field.onBlur}
            error={error}
            label={label}
            placeholder={placeholder}
            hint={hint}
            required={required}
            disabled={disabled}
            rows={rows}
            maxLength={maxLength}
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
      value={valueProp ?? ''}
      onChange={(v) => onChangeProp?.(v)}
      label={label}
      placeholder={placeholder}
      hint={hint}
      required={required}
      disabled={disabled}
      rows={rows}
      maxLength={maxLength}
      errorVariant={errorVariant}
      classNames={classNames}
    />
  )
}
