'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Info, RotateCcw } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import type { ThemeSettingValue } from '@/Themes/contract/settings'
import { ThemeSettingsServices } from './Services/ThemeSettingsServices'
import type { ThemeSettingsAdminView } from './Queries/themeSettingsAdminQueries'
import ThemeSettingsForm from './Components/ThemeSettingsForm'

/**
 * Appearance → Theme Settings.
 *
 * CONFIGURING A THEME NEVER ACTIVATES IT. The selector switches which theme's
 * values are being edited and nothing else — `settings.activeTheme` is not
 * touched by any verb on this screen. That is what makes "set the new theme up
 * before switching to it" possible, which is the behaviour operators expect
 * from a CMS.
 *
 * The form is generated entirely from the definition metadata the API returns.
 * A theme supplies declarative fields; it cannot inject React here.
 */
export default function ThemeSettingsModule({
  initialView,
}: {
  initialView: ThemeSettingsAdminView
}) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState(initialView.slug)
  const [errors, setErrors] = useState<string[]>([])
  const [confirmReset, setConfirmReset] = useState(false)

  const { data: view } = useQuery({
    queryKey: ['theme-settings', selected],
    queryFn: () => ThemeSettingsServices.get(selected),
    initialData: selected === initialView.slug ? initialView : undefined,
  })

  const captureError = (error: unknown) => {
    const response = (error as { response?: { status?: number; data?: { message?: unknown } } })
      .response
    if (response?.status === 422) {
      const message = response.data?.message
      setErrors(Array.isArray(message) ? message.map(String) : [String(message)])
    } else {
      setErrors(['Those settings could not be saved. Please try again.'])
    }
  }

  const save = useMutation({
    mutationFn: (values: Record<string, ThemeSettingValue>) =>
      ThemeSettingsServices.save(selected, values),
    onMutate: () => setErrors([]),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['theme-settings', selected] }),
    onError: captureError,
  })

  const reset = useMutation({
    mutationFn: () => ThemeSettingsServices.reset(selected),
    onMutate: () => setErrors([]),
    onSuccess: async () => {
      setConfirmReset(false)
      await queryClient.invalidateQueries({ queryKey: ['theme-settings', selected] })
    },
    onError: captureError,
  })

  if (!view) return null

  return (
    <div className="flex flex-col gap-6 p-4">
      <header>
        <h1 className="text-xl font-bold">Theme Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Presentation options the theme itself provides. Each theme keeps its own settings, so
          switching themes never changes them.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-4">
        <label htmlFor="theme-select" className="text-sm font-medium">
          Configuring
        </label>
        <select
          id="theme-select"
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          value={selected}
          onChange={(event) => {
            // Cleared here rather than in an effect: one theme's refusal must
            // not be shown against another theme's form, and the selection
            // change is the event that makes it stale.
            setErrors([])
            setSelected(event.target.value)
          }}
        >
          {view.choices.map((choice) => (
            <option key={choice.slug} value={choice.slug}>
              {choice.name}
              {choice.rendering ? ' — rendering now' : ''}
              {choice.configurable ? '' : ' (no settings)'}
            </option>
          ))}
        </select>
        {view.rendering ? (
          <ElementBadge variant="success">Rendering</ElementBadge>
        ) : (
          <ElementBadge variant="muted">Not active</ElementBadge>
        )}
        <p className="w-full text-xs text-muted-foreground">
          Editing a theme you have not activated is fine — saving here never switches the site to
          it.
        </p>
      </div>

      {view.fallbackFrom && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-light p-4 text-sm"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
          <p>
            {/* The stored slug is untrusted text from the database and is
                rendered as a text child, so React escapes it. */}
            The site is rendering <span className="font-medium">{view.name}</span> because the
            selected theme &ldquo;{view.fallbackFrom}&rdquo; is not available in this build. Its own
            saved settings are untouched and will apply again if it is reinstalled.
          </p>
        </div>
      )}

      {view.issues.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning-light p-4 text-sm">
          {view.issues.map((issue, index) => (
            <p key={`${issue.kind}-${issue.field ?? index}`}>{issue.message}</p>
          ))}
        </div>
      )}

      {errors.length > 0 && <ValidationBox messages={errors} />}

      {view.fields === null || view.fields.length === 0 ? (
        <p className="flex items-start gap-2 rounded-lg border border-border p-4 text-sm text-muted-foreground">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
          This theme does not define configurable settings.
        </p>
      ) : (
        <>
          <ThemeSettingsForm
            key={`${view.slug}-${view.stored}-${JSON.stringify(view.values)}`}
            fields={view.fields}
            values={view.values}
            isSaving={save.isPending}
            onSubmit={(values) => save.mutate(values)}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">
              {view.stored
                ? 'This theme has saved settings. Resetting removes them and returns every field to the theme default.'
                : 'This theme is using its defaults. There is nothing to reset.'}
            </p>
            <ElementButton
              variant="outline"
              disabled={!view.stored || reset.isPending}
              onClick={() => setConfirmReset(true)}
            >
              <RotateCcw size={14} />
              Reset to theme defaults
            </ElementButton>
          </div>
        </>
      )}

      <ElementModal.Confirm
        isOpen={confirmReset}
        onClose={() => setConfirmReset(false)}
        variant="default"
        title={`Reset ${view.name} to its defaults?`}
        description="Saved values for this theme are removed. Other themes are not affected, and the site does not change which theme it renders."
        confirmText="Reset"
        isLoading={reset.isPending}
        onConfirm={() => reset.mutate()}
      />
    </div>
  )
}
