'use client'

import { useState } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import type { DestinationDraft, MigrationSnapshot } from './MigrationTypes'

/**
 * CHOOSING WHERE THE FILES ARE GOING, AND HOW THEY GET THERE.
 *
 * Two decisions, both made explicitly and neither defaulted:
 *
 *   THE DESTINATION. An S3-compatible location is five fields an operator
 *   types, because it names a remote service that authenticates them anyway. A
 *   Local destination is NOT a text box. It is whatever the deployment set in
 *   `LOCAL_STORAGE_PATH`, shown read-only — a path typed into a browser can
 *   point outside the container's persistent volume, and that mistake is
 *   invisible until the next restart takes every upload with it. There is no
 *   field here to type one into, and the API discards a path even if a crafted
 *   request sends one.
 *
 *   THE MODE. "FlowCMS migrates the files" and "I already migrated them" do
 *   completely different things, and the second one never writes to the
 *   destination. Neither is preselected: guessing which an operator meant is
 *   not a choice software gets to make on their behalf.
 */

interface Props {
  snapshot: MigrationSnapshot
  onCreate: (mode: 'copy' | 'verify', destination: DestinationDraft) => Promise<void>
  onCancel: () => void
  errors: string[]
  busy: boolean
}

type Mode = 'copy' | 'verify' | null

const EMPTY: DestinationDraft = {
  driver: 's3',
  endpoint: '',
  region: '',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
}

export default function DestinationStep({ snapshot, onCreate, onCancel, errors, busy }: Props) {
  const [driver, setDriver] = useState<'s3' | 'local'>('s3')
  const [mode, setMode] = useState<Mode>(null)
  const methods = useForm<DestinationDraft>({ defaultValues: EMPTY })
  const local = snapshot.localDestination

  const submit = methods.handleSubmit(async (values) => {
    if (!mode) return
    await onCreate(mode, { ...values, driver })
  })

  return (
    <FormProvider {...methods}>
      <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
        <ValidationBox messages={errors} />

        <section className="flex flex-col gap-3">
          <h4 className="text-sm font-semibold">1. Where are the files going?</h4>

          <div className="grid gap-3 sm:grid-cols-2">
            <Choice
              selected={driver === 's3'}
              onSelect={() => setDriver('s3')}
              title="S3-compatible storage"
              body="A bucket on AWS S3, Cloudflare R2, MinIO, Garage or anything else that speaks the S3 API."
            />
            <Choice
              selected={driver === 'local'}
              onSelect={() => setDriver('local')}
              title="Local filesystem"
              body={
                local.available
                  ? `This deployment's directory: ${local.root}`
                  : 'Not configured on this deployment.'
              }
              disabled={!local.available}
            />
          </div>

          {driver === 's3' && (
            <div className="flex flex-col gap-4 rounded-md border p-4">
              <ElementInput
                name="endpoint"
                label="Endpoint"
                placeholder="https://s3.example.com"
                description="Leave blank for AWS S3 itself."
              />
              <ElementInput name="region" label="Region" placeholder="auto" />
              <ElementInput name="bucket" label="Bucket" placeholder="media" />
              <ElementInput name="accessKeyId" label="Access Key ID" placeholder="AKIA..." />
              <ElementInput
                name="secretAccessKey"
                type="password"
                label="Secret Access Key"
                description="Stored only until the migration completes, then removed. It is never shown again after you submit it."
              />
            </div>
          )}

          {driver === 'local' && !local.available && (
            <p className="rounded-md border border-warning/30 bg-warning-light px-3 py-2.5 text-xs text-warning">
              {local.reason}
            </p>
          )}

          {driver === 'local' && local.available && (
            <div className="rounded-md border p-4">
              <p className="text-xs font-medium text-muted-foreground">Destination directory</p>
              <p className="mt-1 text-sm break-all">{local.root}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Set by <code>LOCAL_STORAGE_PATH</code> in this deployment&apos;s environment, and
                deliberately not editable here: a path that points outside the persistent volume
                loses every file on the next restart, silently. To use a different directory,
                change the environment variable and restart first.
              </p>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h4 className="text-sm font-semibold">2. How do the files get there?</h4>

          <div className="grid gap-3 sm:grid-cols-2">
            <Choice
              selected={mode === 'copy'}
              onSelect={() => setMode('copy')}
              title="Migrate the files with FlowCMS"
              body="FlowCMS copies everything that is missing, reads each file back and checks it byte for byte, then catches up on anything that changed before the switch."
            />
            <Choice
              selected={mode === 'verify'}
              onSelect={() => setMode('verify')}
              title="I have already migrated the files"
              body="FlowCMS copies nothing. It checks that the destination holds every file, with identical content, and refuses to switch if anything is missing or different."
            />
          </div>

          {mode === 'verify' && (
            <p className="rounded-md border border-info/30 bg-info-light px-3 py-2.5 text-xs text-info">
              Verification does not fix anything. If a file is missing at the destination, FlowCMS
              reports it and stops — it will not copy it for you, because that would hide the fact
              that your own migration was incomplete.
            </p>
          )}
        </section>

        <div className="flex items-center gap-2">
          <ElementButton
            type="submit"
            isLoading={busy}
            disabled={!mode || (driver === 'local' && !local.available)}
          >
            Continue
          </ElementButton>
          <ElementButton type="button" variant="cancel" onClick={onCancel} disabled={busy}>
            Cancel
          </ElementButton>
        </div>
      </form>
    </FormProvider>
  )
}

function Choice({
  selected,
  onSelect,
  title,
  body,
  disabled,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  body: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={[
        'flex flex-col gap-1 rounded-md border p-4 text-left transition-colors',
        selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      ].join(' ')}
    >
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{body}</span>
    </button>
  )
}
