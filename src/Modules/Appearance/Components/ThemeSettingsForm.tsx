'use client'

import { useState } from 'react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import { isSafeColor } from '@/Themes/validation/settingsDefinition'
import type { ThemeSettingField, ThemeSettingValue } from '@/Themes/contract/settings'

/**
 * The generic, core-owned settings form.
 *
 * Rendered entirely from the declarative definition. A theme describes fields;
 * it never supplies a component, so no theme code runs in the admin panel.
 *
 * Deliberately built from plain inputs rather than the `Element*` form library:
 * those components bind to `react-hook-form` by a STATIC field name, and this
 * form's fields are only known at runtime. Wiring a dynamic schema through them
 * would mean generating a Zod object per render to get back what the definition
 * already states. The validation below mirrors the server's exactly — the
 * server is the authority and refuses anything this misses.
 */

function fieldError(field: ThemeSettingField, value: ThemeSettingValue): string | null {
  switch (field.type) {
    case "text":
    case "textarea": {
      if (typeof value !== "string") return "Must be text"
      const max = field.maxLength
      return max !== undefined && value.length > max ? `Must be ${max} characters or fewer` : null
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "Must be a number"
      if (field.min !== undefined && value < field.min) return `Must be ${field.min} or more`
      if (field.max !== undefined && value > field.max) return `Must be ${field.max} or less`
      return null
    }
    case "color":
      return isSafeColor(value) ? null : "Must be a hex colour such as #3366ff"
    case "select":
      return field.options.some((option) => option.value === value) ? null : "Choose an option"
    case "boolean":
      return typeof value === "boolean" ? null : "Must be true or false"
  }
}

export default function ThemeSettingsForm({
  fields,
  values: initial,
  isSaving,
  onSubmit,
}: {
  fields: ThemeSettingField[]
  values: Record<string, ThemeSettingValue>
  isSaving: boolean
  onSubmit: (values: Record<string, ThemeSettingValue>) => void
}) {
  const [values, setValues] = useState<Record<string, ThemeSettingValue>>(() => ({ ...initial }))

  const set = (key: string, value: ThemeSettingValue) =>
    setValues((current) => ({ ...current, [key]: value }))

  const errors = new Map<string, string>()
  for (const field of fields) {
    const error = fieldError(field, values[field.key])
    if (error) errors.set(field.key, error)
  }

  return (
    <form
      className="flex flex-col gap-5 rounded-xl border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (errors.size === 0) onSubmit(values)
      }}
    >
      {fields.map((field) => {
        const value = values[field.key]
        const error = errors.get(field.key)
        const describedBy = field.description ? `${field.key}-description` : undefined

        return (
          <div key={field.key} className="flex flex-col gap-1.5">
            <label htmlFor={field.key} className="text-sm font-medium">
              {field.label}
            </label>
            {field.description && (
              <p id={describedBy} className="text-xs text-muted-foreground">
                {field.description}
              </p>
            )}

            {field.type === "boolean" ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  id={field.key}
                  type="checkbox"
                  className="size-4"
                  aria-describedby={describedBy}
                  checked={value === true}
                  onChange={(event) => set(field.key, event.target.checked)}
                />
                <span className="text-muted-foreground">Enabled</span>
              </label>
            ) : field.type === "select" ? (
              <select
                id={field.key}
                className="w-full max-w-sm rounded-md border border-border bg-background px-3 py-2 text-sm"
                aria-describedby={describedBy}
                value={typeof value === "string" ? value : ""}
                onChange={(event) => set(field.key, event.target.value)}
              >
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === "textarea" ? (
              <textarea
                id={field.key}
                rows={4}
                maxLength={field.maxLength}
                placeholder={field.placeholder}
                aria-describedby={describedBy}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={typeof value === "string" ? value : ""}
                onChange={(event) => set(field.key, event.target.value)}
              />
            ) : field.type === "number" ? (
              <input
                id={field.key}
                type="number"
                min={field.min}
                max={field.max}
                step={field.step}
                aria-describedby={describedBy}
                className="w-full max-w-40 rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={typeof value === "number" ? value : ""}
                // `valueAsNumber` is NaN for an empty box; the server rejects
                // non-finite numbers regardless, and the inline error shows
                // before anyone can submit it.
                onChange={(event) => set(field.key, event.target.valueAsNumber)}
              />
            ) : field.type === "color" ? (
              <div className="flex items-center gap-2">
                <input
                  id={field.key}
                  type="color"
                  aria-describedby={describedBy}
                  className="h-9 w-14 rounded-md border border-border bg-background"
                  value={isSafeColor(value) ? String(value).slice(0, 7) : "#000000"}
                  onChange={(event) => set(field.key, event.target.value)}
                />
                <input
                  type="text"
                  aria-label={`${field.label} hex value`}
                  className="w-32 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
                  value={typeof value === "string" ? value : ""}
                  onChange={(event) => set(field.key, event.target.value)}
                />
              </div>
            ) : (
              <input
                id={field.key}
                type="text"
                maxLength={field.maxLength}
                placeholder={field.placeholder}
                aria-describedby={describedBy}
                className="w-full max-w-lg rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={typeof value === "string" ? value : ""}
                onChange={(event) => set(field.key, event.target.value)}
              />
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )
      })}

      <div className="flex justify-end">
        <ElementButton type="submit" isLoading={isSaving} disabled={errors.size > 0}>
          Save settings
        </ElementButton>
      </div>
    </form>
  )
}
