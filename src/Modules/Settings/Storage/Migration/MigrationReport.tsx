'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import { MigrationServices } from './MigrationServices'
import type { MigrationJob } from './MigrationTypes'

/**
 * WHAT THE ANALYSIS FOUND, AND WHICH FILES IT FOUND IT IN.
 *
 * Counts alone are not actionable — an operator told "3 conflicts" cannot do
 * anything about them. So the counts are also a way in: choosing one loads that
 * page of keys, with the reason FlowCMS recorded for each.
 *
 * PAGINATED, NOT SLICED. A store with half a million objects would otherwise
 * turn this panel into a half-million-row JSON download. The durable table is
 * the source of truth and this is a window onto it, which also means the report
 * survives a reload with no state to restore.
 *
 * THERE IS NO FIX-IT BUTTON, DELIBERATELY. Neither "overwrite the destination"
 * nor "rename the incompatible key" is offered: the first destroys somebody's
 * file, and the second breaks every published link to the one it renames, since
 * object keys are what `/api/public/images/...` URLs are built from. The only
 * resolution is at the source or the destination, followed by a fresh analysis.
 */

const CLASSIFICATIONS = [
  { key: 'missing', label: 'To copy', variant: 'info' as const },
  { key: 'matching', label: 'Already identical', variant: 'success' as const },
  { key: 'conflicting', label: 'Conflicting', variant: 'destructive' as const },
  { key: 'incompatible', label: 'Cannot be represented', variant: 'destructive' as const },
  { key: 'destination_only', label: 'Extra at destination', variant: 'warning' as const },
]

const PAGE = 25

export default function MigrationReport({ job }: { job: MigrationJob }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)

  // A QUERY RATHER THAN AN EFFECT. The page of keys is server state keyed by
  // (job, classification, offset) — expressing it as a fetch inside an effect
  // means clearing and refilling local state on every change, which is both a
  // cascading render and an extra frame showing the previous filter's keys.
  const { data: page, isFetching } = useQuery({
    queryKey: ['storage-migration-entries', job.id, selected, offset],
    queryFn: () =>
      MigrationServices.entries(job.id, { classification: selected! }, { limit: PAGE, offset }),
    enabled: selected !== null,
  })

  const entries = page?.entries ?? []
  const total = page?.total ?? 0
  const counts = job.counts.byClassification

  return (
    <section className="flex flex-col gap-3">
      <h4 className="text-sm font-semibold">What the analysis found</h4>

      <div className="flex flex-wrap gap-2">
        {CLASSIFICATIONS.map(({ key, label, variant }) => {
          const count = counts[key] ?? 0
          const active = selected === key
          return (
            <button
              key={key}
              type="button"
              disabled={count === 0}
              onClick={() => {
                setOffset(0)
                setSelected(active ? null : key)
              }}
              className={[
                'rounded-md border px-3 py-2 text-left transition-colors',
                active ? 'border-primary bg-primary/5' : 'border-border',
                count === 0 ? 'cursor-default opacity-50' : 'cursor-pointer hover:bg-muted',
              ].join(' ')}
            >
              <span className="block text-lg font-semibold tabular-nums">{count}</span>
              <ElementBadge variant={variant} size="xs">
                {label}
              </ElementBadge>
            </button>
          )
        })}
      </div>

      {selected && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          {isFetching && <p className="text-sm text-muted-foreground">Loading…</p>}

          {!isFetching && entries.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing to show.</p>
          )}

          {!isFetching &&
            entries.map((entry) => (
              <div key={entry.key} className="flex flex-col gap-0.5 border-b pb-2 last:border-b-0 last:pb-0">
                <code className="text-xs break-all">{entry.key}</code>
                {entry.detail && (
                  <p className="text-xs text-muted-foreground">{entry.detail}</p>
                )}
              </div>
            ))}

          {total > PAGE && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted-foreground">
                {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
              </span>
              <div className="flex gap-1">
                <ElementButton
                  type="button"
                  size="sm"
                  variant="cancel"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE))}
                >
                  Previous
                </ElementButton>
                <ElementButton
                  type="button"
                  size="sm"
                  variant="cancel"
                  disabled={offset + PAGE >= total}
                  onClick={() => setOffset(offset + PAGE)}
                >
                  Next
                </ElementButton>
              </div>
            </div>
          )}

          {(selected === 'conflicting' || selected === 'incompatible') && (
            <p className="mt-1 rounded-md border border-warning/30 bg-warning-light px-3 py-2.5 text-xs text-warning">
              {selected === 'conflicting'
                ? 'These keys already exist at the destination with different content. FlowCMS will not overwrite them — resolve each one at the destination, then re-run the analysis.'
                : 'These keys cannot become file paths at the destination. FlowCMS will not rename them: the keys are referenced by published content, and rewriting one would break every link to it. Rename or remove them at the source, then re-run the analysis.'}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
