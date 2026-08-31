'use client'

import { useState } from 'react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import type { MigrationJob } from './MigrationTypes'

/**
 * THE LAST SCREEN BEFORE THE IRREVERSIBLE STEP.
 *
 * Everything on it exists to answer one question honestly: what is about to
 * change, and what is not.
 *
 * IT SUMMARISES BOTH ENDS. An operator who has been away for an hour of copying
 * should not have to remember which destination they configured, and "cut over"
 * with no statement of where is a button nobody can be responsible for
 * pressing.
 *
 * IT STATES WHAT IS RETAINED. The old storage is not emptied, not deleted, and
 * not touched — that is a guarantee of the design, not a detail, and it is the
 * single thing that makes the decision reversible in practice even though
 * nothing here can undo it.
 *
 * IT DOES NOT PROMISE A WAY BACK. There is no rollback and there will not be
 * one: after the switch, uploads land at the destination, and flipping back
 * would silently lose them. Going back means running another verified migration
 * in the other direction.
 */

interface Props {
  job: MigrationJob
  onCutover: () => Promise<void>
  onAcknowledgeExtras: () => Promise<void>
  errors: string[]
  busy: boolean
}

export default function CutoverStep({
  job,
  onCutover,
  onAcknowledgeExtras,
  errors,
  busy,
}: Props) {
  const [confirmed, setConfirmed] = useState(false)
  const extrasOutstanding =
    job.extras.count > 0 && (!job.extras.acknowledged || job.extras.acknowledgementStale)

  return (
    <section className="flex flex-col gap-4">
      <ValidationBox messages={errors} />

      <div className="rounded-md border p-4">
        <h4 className="text-sm font-semibold">Ready to switch</h4>

        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <Row label="Current storage" value={job.source.label} />
          <Row label="New storage" value={job.destination.label} />
          <Row
            label="Migration mode"
            value={
              job.mode === 'copy'
                ? 'FlowCMS migrated the files'
                : 'Verified a migration you performed'
            }
          />
          <Row label="Files verified at the destination" value={String(job.progress.verified)} />
          <Row label="Extra files already at the destination" value={String(job.extras.count)} />
        </dl>
      </div>

      {extrasOutstanding && (
        <div className="flex flex-col gap-3 rounded-md border border-warning/30 bg-warning-light px-3 py-3">
          <p className="text-xs text-warning">
            {job.extras.acknowledgementStale
              ? `The destination has changed since you acknowledged its extra files. It now holds ${job.extras.count} file(s) that are not at the source.`
              : `The destination already holds ${job.extras.count} file(s) that are not at the source.`}{' '}
            FlowCMS will not delete them. After the switch they will appear in the File Manager
            alongside your own media.
          </p>
          <div>
            <ElementButton type="button" size="sm" variant="outline" onClick={onAcknowledgeExtras} isLoading={busy}>
              I understand — keep them
            </ElementButton>
          </div>
        </div>
      )}

      <div className="rounded-md border border-destructive/30 bg-destructive-light px-3 py-3">
        <p className="text-xs font-semibold text-destructive">This cannot be undone.</p>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-xs text-destructive">
          <li>
            Storage is briefly read-only while the switch happens. Uploads are refused for a few
            seconds; the public site keeps serving throughout.
          </li>
          <li>
            Your existing storage is <strong>kept exactly as it is</strong>. Nothing is emptied and
            nothing is deleted.
          </li>
          <li>
            There is no instant switch back. Uploads will land at the new location from this point
            on, so returning means running another verified migration in the other direction.
          </li>
          <li>
            Every file keeps its exact key, so links in published posts and pages keep working.
          </li>
        </ul>
      </div>

      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-0.5"
        />
        <span className="text-sm">
          I want FlowCMS to start using <strong>{job.destination.label}</strong> for all media from
          now on.
        </span>
      </label>

      <div>
        <ElementButton
          type="button"
          onClick={onCutover}
          isLoading={busy}
          disabled={!confirmed || !job.cutoverAllowed}
        >
          Switch storage now
        </ElementButton>
      </div>

      {!job.cutoverAllowed && job.cutoverBlockedBy.length > 0 && (
        <ValidationBox messages={job.cutoverBlockedBy} />
      )}
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm break-all">{value}</dd>
    </div>
  )
}
