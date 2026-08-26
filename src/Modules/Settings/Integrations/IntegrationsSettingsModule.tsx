'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementCheckbox from '@/components/shared/ElementCheckbox/ElementCheckbox'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementToast from '@/components/shared/ElementToast/ElementToast'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import SettingsShell from '@/Modules/Settings/Components/SettingsShell'
import { SettingsServices } from '@/Modules/Settings/Services/SettingsServices'
import {
  IntegrationsServices,
  type GscConnectionCheck,
  type BingConnectionCheck,
} from '@/Modules/Settings/Services/IntegrationsServices'
import { updateSiteSettingsSchema, type UpdateSiteSettingsFormValues } from '@/Modules/Settings/Values/Validations'

const EMPTY: UpdateSiteSettingsFormValues = {
  gscClientId: '', gscClientSecret: '', gscSiteUrl: '', clearGscClientSecret: false,
  pagespeedApiKey: '', clearPagespeedApiKey: false,
  bingApiKey: '', clearBingApiKey: false, bingSiteUrl: '',
}

export default function IntegrationsSettingsModule() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [isChecking, setIsChecking] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [checkResult, setCheckResult] = useState<GscConnectionCheck | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)

  const [isCheckingBing, setIsCheckingBing] = useState(false)
  const [checkBingResult, setCheckBingResult] = useState<BingConnectionCheck | null>(null)
  const [checkBingError, setCheckBingError] = useState<string | null>(null)

  const { data: settings, isLoading } = useQuery({
    queryKey: ['global-settings'],
    queryFn: SettingsServices.get,
  })

  const methods = useForm<UpdateSiteSettingsFormValues>({
    resolver: zodResolver(updateSiteSettingsSchema),
    defaultValues: EMPTY,
  })

  const { handleSubmit, reset, watch, formState: { isSubmitting } } = methods
  const clearSecretChecked = watch('clearGscClientSecret')
  const clearPagespeedKeyChecked = watch('clearPagespeedApiKey')
  const clearBingKeyChecked = watch('clearBingApiKey')

  useEffect(() => {
    if (settings) {
      reset({
        gscClientId: settings.gscClientId,
        // The secret itself is never sent to the client — always starts
        // blank, regardless of whether one is currently stored.
        gscClientSecret: '',
        gscSiteUrl: settings.gscSiteUrl,
        clearGscClientSecret: false,
        pagespeedApiKey: '',
        clearPagespeedApiKey: false,
        bingApiKey: '',
        clearBingApiKey: false,
        bingSiteUrl: settings.bingSiteUrl,
      })
    }
  }, [settings, reset])

  // The OAuth redirect lands back here with ?gscConnected=1 or ?gscError=...
  // — surface it once, then strip the query string so a refresh doesn't
  // re-show the toast.
  useEffect(() => {
    const connected = searchParams.get('gscConnected')
    const error = searchParams.get('gscError')
    if (!connected && !error) return

    if (connected) {
      ElementToast.success('Connected to Google Search Console')
      queryClient.invalidateQueries({ queryKey: ['global-settings'] })
    } else if (error) {
      ElementToast.error(error)
    }
    router.replace(pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const onSubmit = async (values: UpdateSiteSettingsFormValues) => {
    setServerErrors([])
    try {
      const updated = await SettingsServices.update(values)
      queryClient.setQueryData(['global-settings'], updated)
      reset({
        gscClientId: updated.gscClientId,
        gscClientSecret: '',
        gscSiteUrl: updated.gscSiteUrl,
        clearGscClientSecret: false,
        pagespeedApiKey: '',
        clearPagespeedApiKey: false,
        bingApiKey: '',
        clearBingApiKey: false,
        bingSiteUrl: updated.bingSiteUrl,
      })
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

  const handleCheckConnection = async () => {
    setIsChecking(true)
    setCheckError(null)
    try {
      const result = await IntegrationsServices.checkGscConnection()
      setCheckResult(result)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string | string[] } } }
      const raw = axiosErr.response?.data?.message
      setCheckError(Array.isArray(raw) ? raw.join(', ') : raw || 'Could not check the connection.')
      setCheckResult(null)
    } finally {
      setIsChecking(false)
    }
  }

  const handleCheckBingConnection = async () => {
    setIsCheckingBing(true)
    setCheckBingError(null)
    try {
      const result = await IntegrationsServices.checkBingConnection()
      setCheckBingResult(result)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string | string[] } } }
      const raw = axiosErr.response?.data?.message
      setCheckBingError(Array.isArray(raw) ? raw.join(', ') : raw || 'Could not check the connection.')
      setCheckBingResult(null)
    } finally {
      setIsCheckingBing(false)
    }
  }

  const handleDisconnect = async () => {
    setIsDisconnecting(true)
    try {
      const updated = await IntegrationsServices.disconnectGsc()
      queryClient.setQueryData(['global-settings'], updated)
      setCheckResult(null)
      setCheckError(null)
    } finally {
      setIsDisconnecting(false)
    }
  }

  const canConnect = !!settings?.gscClientId && !!settings?.hasGscClientSecret

  return (
    <SettingsShell
      description="Connect this site to Google Search Console to read search performance data. Requires an OAuth 2.0 Client ID from Google Cloud Console."
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
              <h2 className="text-sm font-semibold">Google Search Console</h2>

              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <p className="text-muted-foreground">
                  Authorized redirect URI — paste this into the OAuth client&apos;s settings in{' '}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Google Cloud Console
                  </a>
                  :
                </p>
                <code className="mt-1 block break-all text-foreground">{settings.gscRedirectUri}</code>
              </div>

              <div className="w-full grid grid-cols-2 items-start gap-4">
                <ElementInput name="gscClientId" label="Client ID" placeholder="xxxx.apps.googleusercontent.com" />
                <ElementInput
                  name="gscClientSecret"
                  type="password"
                  label="Client Secret"
                  placeholder={settings.hasGscClientSecret ? '••••••••••••••••' : 'Not set'}
                  hint="Never shown once saved. Leave blank to keep the current one."
                  disabled={clearSecretChecked}
                />
              </div>

              {settings.hasGscClientSecret && (
                <ElementCheckbox
                  name="clearGscClientSecret"
                  label="Clear the stored client secret"
                  hint="Also disconnects — a refresh token minted under the old secret can't be used anymore."
                />
              )}

              <ElementInput
                name="gscSiteUrl"
                label="Site URL"
                placeholder="https://flowcms.tech/ or sc-domain:flowcms.tech"
                hint="Must exactly match a verified property in the connected account — use Check Connection below to see the options."
              />
            </section>

            <section className="flex flex-col gap-4 border-t border-border pt-6">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-sm font-semibold">Connection status</h2>
                {settings.hasGscRefreshToken ? (
                  <ElementBadge variant="success" startContent={<CheckCircle2 size={12} />}>
                    Connected
                  </ElementBadge>
                ) : (
                  <ElementBadge variant="muted" startContent={<XCircle size={12} />}>
                    Not connected
                  </ElementBadge>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <ElementButton
                  asChild={canConnect}
                  variant="outline"
                  disabled={!canConnect}
                  tooltip={!canConnect ? 'Save a Client ID and Client Secret first' : undefined}
                >
                  {canConnect ? (
                    // Deliberately a plain anchor, not next/link. This is the OAuth
                    // start leg: a route handler that answers with a 302 to Google's
                    // consent screen. Client-side navigation cannot follow a redirect
                    // to an external origin, so Link would break the connect flow.
                    // eslint-disable-next-line @next/next/no-html-link-for-pages
                    <a href="/api/integrations/google-search-console/auth">
                      {settings.hasGscRefreshToken ? 'Reconnect to Google' : 'Connect to Google'}
                    </a>
                  ) : (
                    <span>Connect to Google</span>
                  )}
                </ElementButton>

                <ElementButton
                  type="button"
                  variant="cancel"
                  onClick={handleCheckConnection}
                  isLoading={isChecking}
                  disabled={!settings.hasGscRefreshToken}
                >
                  <RefreshCw size={14} /> Check Connection
                </ElementButton>

                {settings.hasGscRefreshToken && (
                  <ElementButton
                    type="button"
                    variant="destructive"
                    onClick={handleDisconnect}
                    isLoading={isDisconnecting}
                  >
                    Disconnect
                  </ElementButton>
                )}
              </div>

              {checkError && (
                <p className="text-sm text-destructive">{checkError}</p>
              )}

              {checkResult && (
                <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  {checkResult.configuredSiteUrl && (
                    <p className="text-sm">
                      {checkResult.configuredSiteVerified ? (
                        <span className="text-success">✓ {checkResult.configuredSiteUrl} is verified for this account.</span>
                      ) : (
                        <span className="text-destructive">✗ {checkResult.configuredSiteUrl} was not found among this account&apos;s verified properties below.</span>
                      )}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {checkResult.sites.length === 0
                      ? 'This account has no verified properties in Search Console.'
                      : 'Verified properties visible to the connected account:'}
                  </p>
                  <ul className="flex flex-col gap-1">
                    {checkResult.sites.map((site) => (
                      <li key={site.siteUrl} className="flex items-center justify-between gap-2 text-sm">
                        <span>{site.siteUrl}</span>
                        <ElementBadge variant="outline">{site.permissionLevel}</ElementBadge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="flex flex-col gap-4 border-t border-border pt-6">
              <h2 className="text-sm font-semibold">PageSpeed Insights (Core Web Vitals)</h2>
              <p className="text-sm text-muted-foreground">
                Powers the Core Web Vitals screen under Search Console. Separate from the Search
                Console connection above — a plain API key, not OAuth. Get one from{' '}
                <a
                  href="https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Google Cloud Console
                </a>
                .
              </p>

              <div className="w-full grid grid-cols-2 items-start gap-4">
                <ElementInput
                  name="pagespeedApiKey"
                  type="password"
                  label="API Key"
                  placeholder={settings.hasPagespeedApiKey ? '••••••••••••••••' : 'Not set'}
                  hint="Never shown once saved. Leave blank to keep the current one."
                  disabled={clearPagespeedKeyChecked}
                />
              </div>

              {settings.hasPagespeedApiKey && (
                <ElementCheckbox
                  name="clearPagespeedApiKey"
                  label="Clear the stored API key"
                />
              )}
            </section>

            <section className="flex flex-col gap-4 border-t border-border pt-6">
              <h2 className="text-sm font-semibold">Bing Webmaster Tools</h2>
              <p className="text-sm text-muted-foreground">
                Powers the Bing Webmaster section of the sidebar. A plain API key, not OAuth — one
                key covers every site verified on the Bing Webmaster account. Get one from{' '}
                <a
                  href="https://www.bing.com/webmasters"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Bing Webmaster Tools
                </a>{' '}
                → Settings → API Access.
              </p>

              <div className="w-full grid grid-cols-2 items-start gap-4">
                <ElementInput
                  name="bingApiKey"
                  type="password"
                  label="API Key"
                  placeholder={settings.hasBingApiKey ? '••••••••••••••••' : 'Not set'}
                  hint="Never shown once saved. Leave blank to keep the current one."
                  disabled={clearBingKeyChecked}
                />
                <ElementInput
                  name="bingSiteUrl"
                  label="Site URL"
                  placeholder="https://flowcms.tech/"
                  hint="Must exactly match a verified site on the connected account — use Check Connection below to see the options."
                />
              </div>

              {settings.hasBingApiKey && (
                <ElementCheckbox
                  name="clearBingApiKey"
                  label="Clear the stored API key"
                />
              )}

              <div className="flex flex-wrap items-center gap-2">
                <ElementButton
                  type="button"
                  variant="cancel"
                  onClick={handleCheckBingConnection}
                  isLoading={isCheckingBing}
                  disabled={!settings.hasBingApiKey}
                >
                  <RefreshCw size={14} /> Check Connection
                </ElementButton>
              </div>

              {checkBingError && (
                <p className="text-sm text-destructive">{checkBingError}</p>
              )}

              {checkBingResult && (
                <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  {checkBingResult.configuredSiteUrl && (
                    <p className="text-sm">
                      {checkBingResult.configuredSiteVerified ? (
                        <span className="text-success">✓ {checkBingResult.configuredSiteUrl} is verified for this account.</span>
                      ) : (
                        <span className="text-destructive">✗ {checkBingResult.configuredSiteUrl} was not found among this account&apos;s verified sites below.</span>
                      )}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {checkBingResult.sites.length === 0
                      ? 'This account has no sites in Bing Webmaster Tools.'
                      : 'Sites visible to the connected account:'}
                  </p>
                  <ul className="flex flex-col gap-1">
                    {checkBingResult.sites.map((site) => (
                      <li key={site.url} className="flex items-center justify-between gap-2 text-sm">
                        <span>{site.url}</span>
                        <ElementBadge variant={site.isVerified ? 'success' : 'muted'}>
                          {site.isVerified ? 'Verified' : 'Not verified'}
                        </ElementBadge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </form>
        </FormProvider>
      )}
    </SettingsShell>
  )
}
