'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementFileSelector from '@/components/shared/ElementFileSelector/ElementFileSelector'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import SettingsShell from '@/Modules/Settings/Components/SettingsShell'
import { SettingsServices } from '@/Modules/Settings/Services/SettingsServices'
import { updateSiteSettingsSchema, type UpdateSiteSettingsFormValues } from '@/Modules/Settings/Values/Validations'

const EMPTY: UpdateSiteSettingsFormValues = {
  siteName: '', tagline: '', logoKey: '', logoAltText: '', faviconKey: '', baseUrl: '',
}

export default function GlobalSettingsModule() {
  const queryClient = useQueryClient()
  const [serverErrors, setServerErrors] = useState<string[]>([])

  const { data: settings, isLoading } = useQuery({
    queryKey: ['global-settings'],
    queryFn: SettingsServices.get,
  })

  const methods = useForm<UpdateSiteSettingsFormValues>({
    resolver: zodResolver(updateSiteSettingsSchema),
    defaultValues: EMPTY,
  })

  const { handleSubmit, reset, formState: { isSubmitting } } = methods

  useEffect(() => {
    if (settings) {
      reset({
        siteName: settings.siteName,
        tagline: settings.tagline,
        logoKey: settings.logoKey ?? '',
        logoAltText: settings.logoAltText ?? '',
        faviconKey: settings.faviconKey ?? '',
        baseUrl: settings.baseUrl,
      })
    }
  }, [settings, reset])

  const onSubmit = async (values: UpdateSiteSettingsFormValues) => {
    setServerErrors([])
    try {
      const updated = await SettingsServices.update(values)
      queryClient.setQueryData(['global-settings'], updated)
      // Every layout/metadata consumer reads settings server-side, so a
      // brand or logo change needs a real reload to actually show up
      // outside this form — a client-cache update alone wouldn't touch
      // the root layout or the sidebar's own fetch.
      window.location.reload()
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
    <SettingsShell
      description="Brand and site URL — everything here overrides the matching environment variable the moment you save. Clear a field to fall back to it again."
      onSave={handleSubmit(onSubmit)}
      isSaving={isSubmitting}
    >
      {isLoading || !settings ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
            <ValidationBox messages={serverErrors} />

            <section className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold">Brand</h2>

              <div className="w-full grid grid-cols-2 items-start gap-4">
                <ElementInput
                  name="siteName"
                  label="Site Title"
                  placeholder="FlowCMS"
                  hint="Shown in the browser tab, search results, and social shares — this is the one place it's set for the whole site."
                />
                {/* Labelled to match /setup. The key stays `tagline`. */}
                <ElementInput
                  name="tagline"
                  label="Description"
                  placeholder="What this site is, in one line"
                  hint="A short description used as a fallback wherever a page doesn't set its own."
                />
              </div>

              <div className="w-full grid grid-cols-2 items-start gap-4">
                <ElementFileSelector
                  name="logoKey"
                  label="Logo"
                  hint="Shown in the admin sidebar. Recommended: a square or wide transparent PNG/SVG."
                  accept="image"
                />
                <ElementInput
                  name="logoAltText"
                  label="Logo Alt Text"
                  placeholder="e.g. FlowCMS logo"
                  hint="Describes the logo for people who can't see it."
                />
              </div>

              <ElementFileSelector
                name="faviconKey"
                label="Favicon"
                hint="The browser-tab icon. Square, ideally 512×512 or larger — it's scaled down automatically. Falls back to the built-in favicon until one is set here."
                accept="image"
              />
            </section>

            <section className="flex flex-col gap-4 border-t border-border pt-6">
              <h2 className="text-sm font-semibold">Site URL</h2>
              <ElementInput
                name="baseUrl"
                label="Base URL"
                placeholder="https://flowcms.tech"
                hint="Used to build every absolute URL this site emits — canonical tags, sitemap.xml, OG images, structured data. Must be the real public domain before submitting to Search Console."
              />
            </section>
          </form>
        </FormProvider>
      )}
    </SettingsShell>
  )
}
