'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Info, Paintbrush } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { cn } from '@/lib/utils'
import { AppearanceServices } from './Services/AppearanceServices'
import type { ThemeAdminView, ThemeCardView, ThemeFallbackView } from './Values/themeAdminView'

/**
 * Appearance → Themes.
 *
 * Lists what is installed in this build and lets an administrator switch which
 * one the public site renders. Installing a theme is a build-time act and is
 * deliberately absent here — there is no upload button, because there is
 * nothing behind one.
 *
 * The data arrives server-rendered (`initialView`) and TanStack re-reads it
 * after a successful activation, so the first paint needs no round trip and the
 * refresh needs no page reload.
 *
 * VOCABULARY. "Rendering" and "Selected" are different words on purpose. During
 * a fallback the theme an operator chose is not the theme visitors see, and a
 * screen that called both of them "Active" would be hiding the one fact they
 * opened this page to find.
 */

const UNAVAILABLE_COPY: Record<'invalid' | 'incompatible', string> = {
  incompatible: 'Not compatible with this version of FlowCMS.',
  invalid: 'This theme package is invalid and cannot be used.',
}

function fallbackHeadline(fallback: ThemeFallbackView): string {
  switch (fallback.reason) {
    case 'missing':
      return 'is selected, but is not available in this build.'
    case 'incompatible':
      return 'is selected, but is not compatible with this version of FlowCMS.'
    case 'invalid':
      return 'is selected, but is not a valid theme.'
  }
}

function FallbackBanner({ fallback }: { fallback: ThemeFallbackView }) {
  return (
    <div
      role="status"
      className="mb-6 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-light p-4"
    >
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
      <div className="text-sm">
        <p className="font-medium">
          {/*
            * Rendered as a text child, never as HTML, an attribute or a URL.
            * This value comes from the database and the strict activation path
            * refuses to create anything unusual — but a row written by an older
            * version, or by hand, can contain anything at all, so it is treated
            * as untrusted text. React escapes it.
            */}
          Theme &ldquo;{fallback.requestedSlug}&rdquo; {fallbackHeadline(fallback)}
        </p>
        <p className="mt-1 text-muted-foreground">
          FlowCMS is using <span className="font-medium">{fallback.activeSlug}</span> instead. Your
          selection has not been changed — activate a theme below to replace it.
        </p>
      </div>
    </div>
  )
}

function StatusBadges({ theme }: { theme: ThemeCardView }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {theme.rendering && (
        <ElementBadge variant="success" className="gap-1">
          <Check size={12} />
          Rendering
        </ElementBadge>
      )}
      {/* Only worth saying when it differs from what is rendering; otherwise
          every card in the normal case would carry two badges saying one thing. */}
      {theme.requested && !theme.rendering && <ElementBadge variant="warning">Selected</ElementBadge>}
      {!theme.available && theme.availabilityReason && (
        <ElementBadge variant="destructive">
          {theme.availabilityReason === 'incompatible' ? 'Incompatible' : 'Invalid'}
        </ElementBadge>
      )}
    </div>
  )
}

function ThemeCard({
  theme,
  onActivate,
  isPending,
  errors,
}: {
  theme: ThemeCardView
  onActivate: (slug: string) => void
  isPending: boolean
  errors: string[]
}) {
  return (
    <article
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border border-border',
        theme.rendering && 'border-success/50',
        !theme.available && 'opacity-75',
      )}
    >
      <div className="flex aspect-[16/10] items-center justify-center border-b border-border bg-muted">
        {theme.screenshot ? (
          /* eslint-disable-next-line @next/next/no-img-element -- a path inside
             the theme's own package, validated by safeScreenshotPath; not an
             optimizable remote pattern */
          <img
            src={theme.screenshot}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          // A neutral placeholder rather than a fabricated preview. Rendering a
          // real thumbnail would mean rendering the theme, which is Preview —
          // deliberately a later phase.
          <Paintbrush size={28} className="text-muted-foreground" aria-hidden />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold leading-tight">{theme.name}</h2>
              <p className="text-xs text-muted-foreground">
                {theme.slug} &middot; v{theme.version}
                {theme.author ? ` · ${theme.author}` : ''}
              </p>
            </div>
          </div>
          <StatusBadges theme={theme} />
        </div>

        {theme.description && (
          <p className="text-sm text-muted-foreground">{theme.description}</p>
        )}

        {!theme.available && theme.availabilityReason && (
          <p className="text-sm text-destructive">{UNAVAILABLE_COPY[theme.availabilityReason]}</p>
        )}

        {errors.length > 0 && <ValidationBox messages={errors} />}

        <div className="mt-auto pt-2">
          {theme.rendering && !theme.requested ? (
            // The fallback case: this theme is on screen but nobody chose it.
            // Activating it is a real action — it clears the stale selection.
            <ElementButton
              onClick={() => onActivate(theme.slug)}
              disabled={isPending || !theme.canActivate}
              isLoading={isPending}
              variant="outline"
              className="w-full"
            >
              Use this theme
            </ElementButton>
          ) : theme.canActivate ? (
            <ElementButton
              onClick={() => onActivate(theme.slug)}
              disabled={isPending}
              isLoading={isPending}
              className="w-full"
            >
              Activate
            </ElementButton>
          ) : (
            <ElementButton disabled variant="outline" className="w-full">
              {theme.available ? 'Active' : 'Unavailable'}
            </ElementButton>
          )}
        </div>
      </div>
    </article>
  )
}

export default function ThemesModule({ initialView }: { initialView: ThemeAdminView }) {
  const queryClient = useQueryClient()
  const [pendingSlug, setPendingSlug] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string[]>>({})

  const { data: view } = useQuery({
    queryKey: ['appearance-themes'],
    queryFn: AppearanceServices.listThemes,
    // Server-rendered, so the first paint costs no request.
    initialData: initialView,
  })

  const activate = useMutation({
    mutationFn: AppearanceServices.activate,
    onMutate: (slug: string) => {
      setPendingSlug(slug)
      setErrors({})
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['appearance-themes'] })
    },
    onError: (error: unknown, slug: string) => {
      // 422 carries the domain layer's message — "not installed in this build",
      // "not compatible" — which belongs next to the theme it refers to rather
      // than in a toast that disappears.
      const response = (error as { response?: { status?: number; data?: { message?: unknown } } })
        .response
      if (response?.status === 422) {
        const message = response.data?.message
        setErrors({ [slug]: Array.isArray(message) ? message.map(String) : [String(message)] })
      }
    },
    onSettled: () => setPendingSlug(null),
  })

  return (
    <div className="flex flex-col gap-6 p-4">
      <header>
        <h1 className="text-xl font-bold">Themes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how the public site looks. Changes take effect immediately.
        </p>
      </header>

      {view.fallback && <FallbackBanner fallback={view.fallback} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {view.themes.map((theme) => (
          <ThemeCard
            key={theme.slug}
            theme={theme}
            onActivate={(slug) => activate.mutate(slug)}
            // Disabled across the board while a mutation is in flight, so a
            // second click cannot race the first.
            isPending={pendingSlug === theme.slug}
            errors={errors[theme.slug] ?? []}
          />
        ))}
      </div>

      {/* Not a dead Upload button. Installing a theme means adding it to the
          build, and saying so is more useful than a control that cannot work. */}
      <p className="flex items-start gap-2 rounded-lg border border-border p-4 text-sm text-muted-foreground">
        <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
        Installing a new theme means adding it to the FlowCMS build. Activating one of the themes
        already built in, as above, needs no rebuild or restart.
      </p>
    </div>
  )
}
