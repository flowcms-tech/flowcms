'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import CutoverStep from './CutoverStep'
import DestinationStep from './DestinationStep'
import MigrationReport from './MigrationReport'
import { MigrationServices } from './MigrationServices'
import type { DestinationDraft, MigrationJob, MigrationSnapshot } from './MigrationTypes'

/**
 * MOVING AN INSTALLATION'S FILES, AS A WORKFLOW RATHER THAN A TOGGLE.
 *
 * The screen this replaces let an owner type a different bucket name and press
 * Save. The next request resolved a different bucket, every image on the site
 * was gone, and the only way back was remembering the old value. Nothing copied
 * a file and nothing warned.
 *
 * So there is no storage selector here. There is a deliberate sequence —
 * configure, prove the destination works, analyse both sides, transfer or
 * verify, review what is blocked, and only then an explicit confirmation — and
 * the source stays authoritative through all of it.
 *
 * THE SERVER'S DATABASE IS THE STATE, NOT THIS COMPONENT. Everything rendered
 * below comes from a snapshot the API computes: the phase, the counts, whether
 * a cutover is allowed and why not. Closing the tab loses a poll, never a
 * position — reopening shows exactly where the migration got to, because it was
 * never here in the first place.
 *
 * BATCHES ARE ASKED FOR, NOT AWAITED IN ONE REQUEST. The transfer loop below
 * issues one bounded call at a time; a single request that copied a whole store
 * would be one timeout away from discarding an hour of work.
 */

/** Phases where there is more work to ask the server for. */
const WORKING = new Set(['destination_tested', 'inventorying', 'ready', 'copying', 'verifying'])

interface Props {
  snapshot: MigrationSnapshot
  onRefresh: () => Promise<void>
}

export default function StorageMigrationPanel({ snapshot, onRefresh }: Props) {
  const [configuring, setConfiguring] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const stop = useRef(false)

  const job = snapshot.job

  const report = useCallback((error: unknown) => {
    const axiosErr = error as { response?: { data?: { message?: string | string[] } } }
    const raw = axiosErr.response?.data?.message
    setErrors(Array.isArray(raw) ? raw : raw ? [raw] : ['Something went wrong. Reload and try again.'])
  }, [])

  /**
   * Asks the server for one batch at a time until it says there is nothing
   * left, refreshing between each.
   *
   * The loop lives here rather than on the server because the server must be
   * able to stop at any point and be resumed by anybody — including a different
   * browser, or the same one an hour later.
   */
  const drive = useCallback(async () => {
    if (!job) return
    setRunning(true)
    stop.current = false
    setErrors([])

    try {
      for (let i = 0; i < 10_000 && !stop.current; i += 1) {
        const snap = await MigrationServices.snapshot()
        const current = snap.job
        if (!current || !WORKING.has(current.status)) break

        if (current.status === 'destination_tested' || current.status === 'inventorying') {
          await MigrationServices.inventoryBatch(current.id)
        } else if (
          current.status === 'ready' ||
          current.status === 'copying' ||
          current.status === 'verifying'
        ) {
          const result = await MigrationServices.advanceBatch(current.id)
          if (result.exhausted && result.job?.status === current.status) break
        }
      }
    } catch (error) {
      report(error)
    } finally {
      setRunning(false)
      await onRefresh()
    }
  }, [job, onRefresh, report])

  // Picks up a migration that was left mid-flight — the tab was closed, the
  // process restarted, or another admin started it. There is nothing to
  // restore, because there was nothing here to lose.
  useEffect(() => {
    return () => {
      stop.current = true
    }
  }, [])

  async function guard(action: () => Promise<void>) {
    setBusy(true)
    setErrors([])
    try {
      await action()
      await onRefresh()
    } catch (error) {
      report(error)
    } finally {
      setBusy(false)
    }
  }

  // ---- no migration open -------------------------------------------------

  if (!job) {
    if (!configuring) {
      return (
        <section className="flex flex-col gap-3 rounded-md border p-4">
          {/* AFTER A CUTOVER. `findActive` correctly returns nothing once the
              job is terminal, and an operator who has just moved their whole
              media library deserves better than a screen that says nothing
              happened — particularly about the part that makes the switch
              survivable, which is that the old storage is still there. */}
          {snapshot.lastCompleted && <CompletedNotice snapshot={snapshot} />}

          <h3 className="text-sm font-semibold">Change storage</h3>
          <p className="text-sm text-muted-foreground">
            Moving to a different bucket or a different backend is a migration, not a settings
            change: FlowCMS copies or verifies every file, checks each one byte for byte, and only
            then switches. Your current storage stays exactly as it is throughout, and is never
            emptied.
          </p>
          <div>
            <ElementButton type="button" onClick={() => setConfiguring(true)}>
              Change storage
            </ElementButton>
          </div>
        </section>
      )
    }

    return (
      <section className="flex flex-col gap-3 rounded-md border p-4">
        <h3 className="text-sm font-semibold">Change storage</h3>
        <DestinationStep
          snapshot={snapshot}
          errors={errors}
          busy={busy}
          onCancel={() => {
            setConfiguring(false)
            setErrors([])
          }}
          onCreate={async (mode: 'copy' | 'verify', destination: DestinationDraft) => {
            await guard(async () => {
              const created = await MigrationServices.create(mode, destination)
              setConfiguring(false)
              // Prove the destination immediately: an operator who mistyped a
              // key should find out now, not after an hour of copying.
              const tested = await MigrationServices.testDestination(created.id)
              if (!tested.ok) setErrors([tested.message ?? 'The destination could not be reached.'])
            })
          }}
        />
      </section>
    )
  }

  // ---- a migration is open -----------------------------------------------

  return (
    <section className="flex flex-col gap-4 rounded-md border p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">Migration in progress</h3>
          <p className="text-xs text-muted-foreground">
            {job.source.label} → {job.destination.label}
          </p>
        </div>
        <StatusBadge job={job} />
      </header>

      <ValidationBox messages={errors} />

      {job.failureReason && job.status !== 'cutting_over' && (
        <p className="rounded-md border border-warning/30 bg-warning-light px-3 py-2.5 text-xs text-warning">
          {job.failureReason}
        </p>
      )}

      {job.status === 'draft' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            The destination has not been proved yet. FlowCMS writes a small file, reads it back,
            compares it and deletes it — a credential that can list but not write would otherwise
            fail thousands of objects into the migration.
          </p>
          <div className="flex gap-2">
            <ElementButton
              type="button"
              isLoading={busy}
              onClick={() =>
                guard(async () => {
                  const tested = await MigrationServices.testDestination(job.id)
                  if (!tested.ok) {
                    setErrors([tested.message ?? 'The destination could not be reached.'])
                  }
                })
              }
            >
              Test the destination
            </ElementButton>
            <CancelButton job={job} busy={busy} guard={guard} />
          </div>
        </div>
      )}

      {WORKING.has(job.status) && (
        <div className="flex flex-col gap-3">
          <Progress job={job} />
          <div className="flex flex-wrap gap-2">
            <ElementButton type="button" onClick={drive} isLoading={running}>
              {actionLabel(job)}
            </ElementButton>
            {running && (
              <ElementButton
                type="button"
                variant="cancel"
                onClick={() => {
                  stop.current = true
                }}
              >
                Pause
              </ElementButton>
            )}
            {!running && <CancelButton job={job} busy={busy} guard={guard} />}
          </div>
          {/* SAID PLAINLY, because the alternative is an operator who closes
              the tab, comes back to an unfinished migration, and concludes it
              failed. FlowCMS has no background job runner, so this browser is
              what asks the server for the next batch — but every batch that
              finished is durable, so closing the page pauses rather than
              loses. */}
          <p className="text-xs text-muted-foreground">
            This runs in bounded batches on the server, driven from this page. <strong>Closing the
            page pauses it safely</strong> — every batch that finished is saved, nothing is lost,
            and reopening resumes from exactly where it stopped. It does not continue on its own
            while the page is closed.
          </p>
        </div>
      )}

      {job.status === 'blocked' && (
        <div className="flex flex-col gap-3">
          <p className="rounded-md border border-destructive/30 bg-destructive-light px-3 py-2.5 text-xs text-destructive">
            This migration cannot continue until the problems below are resolved. FlowCMS will not
            overwrite a file at the destination and will not rename a key, because both would lose
            something that cannot be recovered.
          </p>
          <MigrationReport job={job} />
          <div className="flex flex-wrap gap-2">
            <ElementButton type="button" onClick={drive} isLoading={running}>
              Re-run the analysis
            </ElementButton>
            {job.progress.failed > 0 && (
              <ElementButton
                type="button"
                variant="outline"
                isLoading={busy}
                onClick={() => guard(() => MigrationServices.retryFailed(job.id).then(() => undefined))}
              >
                Retry {job.progress.failed} failed transfer(s)
              </ElementButton>
            )}
            <CancelButton job={job} busy={busy} guard={guard} />
          </div>
        </div>
      )}

      {job.status === 'ready_to_cutover' && (
        <div className="flex flex-col gap-4">
          <MigrationReport job={job} />
          <CutoverStep
            job={job}
            errors={[]}
            busy={busy}
            onAcknowledgeExtras={() =>
              guard(() =>
                MigrationServices.acknowledgeExtras(job.id, job.version).then(() => undefined),
              )
            }
            onCutover={() =>
              guard(async () => {
                const result = await MigrationServices.cutover(job.id, job.version)
                // NEVER INFERRED FROM A 200. The outcome names itself, and
                // anything other than `completed` means the source is still
                // authoritative.
                if (result.outcome !== 'completed') {
                  setErrors('reasons' in result ? result.reasons : ['The cutover did not complete.'])
                }
              })
            }
          />
          <div>
            <CancelButton job={job} busy={busy} guard={guard} />
          </div>
        </div>
      )}

      {job.status === 'cutting_over' && (
        <div className="flex flex-col gap-2 rounded-md border border-info/30 bg-info-light px-3 py-3">
          <p className="text-sm font-semibold text-info">Switching storage…</p>
          <p className="text-xs text-info">
            Storage is read-only for a moment while FlowCMS catches up on anything that changed and
            commits the switch. Nothing has moved until that transaction succeeds — if it does not,
            your current storage stays active. Reload to see the result; do not assume it failed
            because this page went quiet.
          </p>
          {/* Deliberately no Cancel. Mid-switch, "cancel" has no coherent
              meaning: either the topology moved or it did not. */}
        </div>
      )}
    </section>
  )
}

/**
 * What happened, and what did NOT happen.
 *
 * The retention line is the important one. FlowCMS never empties a source, and
 * an operator who does not know that will either assume their old bucket is
 * gone or delete it before they have checked anything. It also states plainly
 * that there is no flip back: uploads have been landing at the new location
 * since the switch, so returning is another verified migration rather than a
 * setting.
 */
function CompletedNotice({ snapshot }: { snapshot: MigrationSnapshot }) {
  const done = snapshot.lastCompleted
  if (!done) return null

  const when = done.cutoverAt ? new Date(done.cutoverAt).toLocaleString() : null

  return (
    <div className="rounded-md border border-success/30 bg-success-light px-3 py-3">
      <p className="text-xs font-semibold text-success">Migration completed</p>
      <p className="mt-1 text-xs text-success">
        This site now uses <strong>{done.destination.label}</strong>
        {when ? ` — switched ${when}` : null}. Every file kept its exact key, so links in published
        posts and pages still work.
      </p>
      <p className="mt-2 text-xs text-success">
        <strong>Your previous storage was retained.</strong> {done.source.label} was not emptied and
        nothing in it was deleted. Remove it yourself once you are satisfied, and keep a backup
        either way.
      </p>
      <p className="mt-2 text-xs text-success">
        There is no instant switch back. Uploads have been landing at the new location since the
        switch, so returning means running another verified migration in the other direction —
        which is the same workflow, started below.
      </p>
    </div>
  )
}

/**
 * What the button does next, in the operator's terms.
 *
 * "Resume" rather than "Copy the files" once anything has been done, because
 * the two describe different situations and only one of them is true when
 * somebody reopens the page on a half-finished migration.
 */
function actionLabel(job: MigrationJob): string {
  if (job.status === 'destination_tested' || job.status === 'inventorying') {
    return job.progress.total > 0 ? 'Resume the analysis' : 'Analyse both sides'
  }
  const started = job.progress.verified > 0 || job.progress.failed > 0
  if (job.mode === 'verify') return started ? 'Resume verifying' : 'Verify the destination'
  return started ? 'Resume copying' : 'Copy and verify the files'
}

function StatusBadge({ job }: { job: MigrationJob }) {
  const map: Record<string, { label: string; variant: 'info' | 'success' | 'warning' | 'destructive' | 'muted' }> = {
    draft: { label: 'Destination not tested', variant: 'muted' },
    destination_tested: { label: 'Destination verified', variant: 'info' },
    inventorying: { label: 'Analysing', variant: 'info' },
    blocked: { label: 'Needs attention', variant: 'destructive' },
    ready: { label: 'Analysed', variant: 'info' },
    copying: { label: 'Transferring', variant: 'info' },
    verifying: { label: 'Verifying', variant: 'info' },
    ready_to_cutover: { label: 'Ready to switch', variant: 'success' },
    cutting_over: { label: 'Switching', variant: 'warning' },
  }
  const badge = map[job.status] ?? { label: job.status, variant: 'muted' as const }
  return <ElementBadge variant={badge.variant}>{badge.label}</ElementBadge>
}

function Progress({ job }: { job: MigrationJob }) {
  const { progress } = job
  const done = progress.verified
  const total = progress.total
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {job.inventory.sourceScanComplete
            ? `${done} of ${total} verified`
            : `${total} entries found so far`}
        </span>
        {job.inventory.sourceScanComplete && <span className="tabular-nums">{pct}%</span>}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${job.inventory.sourceScanComplete ? pct : 0}%` }}
        />
      </div>
      {progress.failed > 0 && (
        <p className="text-xs text-destructive">{progress.failed} transfer(s) failed.</p>
      )}
    </div>
  )
}

/**
 * Cancelling, with the consequence stated.
 *
 * NOTHING AT THE DESTINATION IS DELETED. Files already copied stay there; they
 * cost storage and nothing else, and a cancel button that removed data would be
 * a cancel button that deletes data.
 */
function CancelButton({
  job,
  busy,
  guard,
}: {
  job: MigrationJob
  busy: boolean
  guard: (action: () => Promise<void>) => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <ElementButton type="button" variant="cancel" onClick={() => setConfirming(true)}>
        Cancel migration
      </ElementButton>
    )
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded-md border p-3">
      <p className="text-xs text-muted-foreground">
        Your site keeps using {job.source.label}. Any files already copied to the destination are
        left there — FlowCMS does not delete them, and a later migration will reuse them.
      </p>
      <div className="flex gap-2">
        <ElementButton
          type="button"
          variant="destructive"
          isLoading={busy}
          onClick={() =>
            guard(() => MigrationServices.cancel(job.id, job.version).then(() => undefined))
          }
        >
          Cancel the migration
        </ElementButton>
        <ElementButton type="button" variant="cancel" onClick={() => setConfirming(false)}>
          Keep going
        </ElementButton>
      </div>
    </div>
  )
}
