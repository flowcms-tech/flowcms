'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementCheckbox from '@/components/shared/ElementCheckbox/ElementCheckbox'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import SettingsShell from '@/Modules/Settings/Components/SettingsShell'
import { SettingsServices } from '@/Modules/Settings/Services/SettingsServices'
import { updateSiteSettingsSchema, type UpdateSiteSettingsFormValues } from '@/Modules/Settings/Values/Validations'

/**
 * WHERE UPLOADED FILES LIVE — reported, and only partly editable.
 *
 * This screen used to be a plain form over five S3 fields with one Save button.
 * Typing a different bucket name and saving pointed FlowCMS at a different
 * location: every stored key stayed valid, the new location was empty, and
 * every image on the site was gone. Nothing copied a file, nothing warned, and
 * the only way back was remembering the old value.
 *
 * So this screen now draws a line through the middle of storage configuration:
 *
 *   WHICH BACKEND      environment-only, not shown as a control at all
 *   WHERE IT POINTS    shown, read-only — changing it is a migration
 *   CREDENTIALS        editable, because rotating a key moves no files
 *
 * The read-only half is enforced by the API as well; disabled inputs are a
 * courtesy to the operator, not the rule.
 */

const EMPTY: UpdateSiteSettingsFormValues = {
  s3Endpoint: '', s3Region: '', s3Bucket: '', s3AccessKeyId: '',
  s3SecretAccessKey: '', clearS3SecretAccessKey: false,
}

/** One labelled fact about the active backend. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm break-all">{value || <span className="text-muted-foreground">Not set</span>}</span>
    </div>
  )
}

export default function StorageSettingsModule() {
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

  const { handleSubmit, reset, watch, formState: { isSubmitting } } = methods
  const clearSecretChecked = watch('clearS3SecretAccessKey')

  useEffect(() => {
    if (settings) {
      reset({
        s3Endpoint: settings.s3Endpoint,
        s3Region: settings.s3Region,
        s3Bucket: settings.s3Bucket,
        s3AccessKeyId: settings.s3AccessKeyId,
        // The secret itself is never sent to the client — always starts
        // blank, regardless of whether one is currently stored.
        s3SecretAccessKey: '',
        clearS3SecretAccessKey: false,
      })
    }
  }, [settings, reset])

  const onSubmit = async (values: UpdateSiteSettingsFormValues) => {
    setServerErrors([])
    try {
      // Only the credential fields are submitted. The topology fields are
      // rendered read-only and deliberately left out of the request, so a stale
      // form cannot resubmit an old bucket name.
      const updated = await SettingsServices.update({
        s3AccessKeyId: values.s3AccessKeyId,
        s3SecretAccessKey: values.s3SecretAccessKey,
        clearS3SecretAccessKey: values.clearS3SecretAccessKey,
      })
      queryClient.setQueryData(['global-settings'], updated)
      window.location.reload()
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { message?: string | string[] } } }
      const status = axiosErr.response?.status
      if (status === 422 || status === 409) {
        const raw = axiosErr.response?.data?.message
        setServerErrors(Array.isArray(raw) ? raw : raw ? [raw] : ['An error occurred'])
      } else {
        setServerErrors(['An error occurred'])
      }
    }
  }

  const isLocal = settings?.storageDriver === 'local'
  const isS3 = settings?.storageDriver === 's3'

  return (
    <SettingsShell
      description="Where uploaded files live. The active backend is deployment configuration and is shown here rather than edited — moving files between backends is a migration, not a settings change."
      onSave={isS3 ? handleSubmit(onSubmit) : undefined}
      isSaving={isSubmitting}
    >
      {isLoading || !settings ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
            <ValidationBox messages={serverErrors} />

            <section className="flex flex-col gap-4 rounded-md border p-4">
              <h3 className="text-sm font-semibold">Active storage</h3>

              {settings.storageDriver === null && (
                <p className="text-sm text-destructive">
                  STORAGE_DRIVER is set to a value FlowCMS does not recognise. It must be
                  <code className="mx-1">s3</code> or <code className="mx-1">local</code>. A bundled
                  Garage deployment uses <code className="mx-1">s3</code> — Garage is an
                  S3-compatible server, not a separate driver.
                </p>
              )}

              {isLocal && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <Fact label="Backend" value="Local filesystem" />
                    <Fact label="Path" value={settings.localStoragePath} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Files are stored as ordinary files in this directory. The path is set by
                    LOCAL_STORAGE_PATH in the deployment&apos;s environment and is not editable here:
                    a path that points outside the persistent volume loses every upload on the next
                    restart, silently.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <strong>Single-node.</strong> A second FlowCMS instance does not share this
                    directory unless you have put it on a shared filesystem yourself. Back it up
                    alongside the database.
                  </p>
                </>
              )}

              {isS3 && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <Fact label="Backend" value="S3-compatible object storage" />
                    <Fact label="Bucket" value={settings.s3Bucket} />
                    <Fact label="Endpoint" value={settings.s3Endpoint} />
                    <Fact label="Region" value={settings.s3Region} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    The bucket, endpoint and region say <em>where</em> every file lives. Changing one
                    points FlowCMS at a different location and leaves the existing files behind, so
                    they are shown here rather than edited. Moving storage will be a guided
                    migration.
                  </p>
                </>
              )}
            </section>

            {isS3 && (
              <section className="flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-semibold">Credentials</h3>
                  <p className="text-sm text-muted-foreground">
                    Safe to change at any time: these authenticate against the same bucket above, so
                    rotating them moves no files.
                  </p>
                </div>

                <ElementInput
                  name="s3AccessKeyId"
                  label="Access Key ID"
                  placeholder="AKIA..."
                />
                <ElementInput
                  name="s3SecretAccessKey"
                  type="password"
                  label="Secret Access Key"
                  placeholder={settings.hasS3SecretAccessKey ? '••••••••••••••••' : 'Not set'}
                  hint="Never shown once saved. Leave blank to keep the current one."
                  disabled={clearSecretChecked}
                />

                {settings.hasS3SecretAccessKey && (
                  <ElementCheckbox
                    name="clearS3SecretAccessKey"
                    label="Clear the stored secret key"
                    hint="Reverts to the S3_SECRET_ACCESS_KEY environment variable, if one is set."
                  />
                )}
              </section>
            )}
          </form>
        </FormProvider>
      )}
    </SettingsShell>
  )
}
