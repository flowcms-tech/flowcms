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

const EMPTY: UpdateSiteSettingsFormValues = {
  s3Endpoint: '', s3Region: '', s3Bucket: '', s3AccessKeyId: '',
  s3SecretAccessKey: '', clearS3SecretAccessKey: false,
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
      const updated = await SettingsServices.update(values)
      queryClient.setQueryData(['global-settings'], updated)
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
      description="Where uploaded files live — everything here overrides the matching environment variable the moment you save. Clear a field to fall back to it again."
      onSave={handleSubmit(onSubmit)}
      isSaving={isSubmitting}
    >
      {isLoading || !settings ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ValidationBox messages={serverErrors} />

            <div className="w-full grid grid-cols-2 items-start gap-4">
              <ElementInput
                name="s3Endpoint"
                label="Endpoint"
                placeholder="https://s3.example.com"
                hint="Only needed for an S3-compatible provider that isn't AWS itself."
              />
              <ElementInput name="s3Region" label="Region" placeholder="us-east-1" />
            </div>

            <ElementInput name="s3Bucket" label="Bucket" placeholder="flowcms" />

            <div className="w-full grid grid-cols-2 items-start gap-4">
              <ElementInput name="s3AccessKeyId" label="Access Key ID" placeholder="AKIA..." />
              <ElementInput
                name="s3SecretAccessKey"
                type="password"
                label="Secret Access Key"
                placeholder={settings.hasS3SecretAccessKey ? '••••••••••••••••' : 'Not set'}
                hint="Never shown once saved. Leave blank to keep the current one."
                disabled={clearSecretChecked}
              />
            </div>

            {settings.hasS3SecretAccessKey && (
              <ElementCheckbox
                name="clearS3SecretAccessKey"
                label="Clear the stored secret key"
                hint="Reverts to the S3_SECRET_ACCESS_KEY environment variable, if one is set."
              />
            )}
          </form>
        </FormProvider>
      )}
    </SettingsShell>
  )
}
