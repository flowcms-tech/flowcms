'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PlugZap, ExternalLink, Send } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ElementTableButton from '@/components/shared/ElementTable/TableActionsButton/ElementTableButton'
import PaginatedDimensionTable from './Components/PaginatedDimensionTable'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import { SearchConsoleServices } from './Services/SearchConsoleServices'
import type { GscSitemapRow } from './Types'

function formatDateTime(iso: string | null): string {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
      <PlugZap size={22} className="text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-xs leading-snug text-muted-foreground">{children}</p>
    </div>
  )
}

export default function SitemapsModule() {
  const queryClient = useQueryClient()
  const [pathInput, setPathInput] = useState('/sitemap-index.xml')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<GscSitemapRow | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['gsc-sitemaps'],
    queryFn: () => SearchConsoleServices.listSitemaps(),
  })

  const invalidate = (fresh: Awaited<ReturnType<typeof SearchConsoleServices.listSitemaps>>) =>
    queryClient.setQueryData(['gsc-sitemaps'], fresh)

  const handleSubmit = async () => {
    if (!pathInput.trim()) return
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const fresh = await SearchConsoleServices.submitSitemap(pathInput.trim())
      invalidate(fresh)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string | string[] } } }
      const raw = axiosErr.response?.data?.message
      setSubmitError(Array.isArray(raw) ? raw.join(', ') : raw || 'Could not submit this sitemap.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      const fresh = await SearchConsoleServices.deleteSitemap(deleteTarget.path)
      invalidate(fresh)
      setDeleteTarget(null)
    } catch {
      return
    } finally {
      setIsDeleting(false)
    }
  }

  const sitemaps = data?.sitemaps ?? []

  const columns: ExtendedColumnDef<GscSitemapRow>[] = [
    {
      id: 'path',
      accessorKey: 'path',
      header: 'Path',
      cell: ({ row }) => (
        <a
          href={row.original.path}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <span className="max-w-sm truncate">{row.original.path.replace(/^https?:\/\//, '')}</span>
          <ExternalLink size={12} className="shrink-0" />
        </a>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.isSitemapsIndex ? 'Sitemap index' : row.original.type ?? '—'}
        </span>
      ),
    },
    {
      id: 'pending',
      header: 'Status',
      cell: ({ row }) =>
        row.original.isPending ? (
          <ElementBadge variant="info">Pending</ElementBadge>
        ) : (
          <ElementBadge variant="success">Processed</ElementBadge>
        ),
    },
    {
      id: 'urlCount',
      header: 'URLs submitted',
      alignRight: true,
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.urlCount}</span>,
    },
    {
      id: 'issues',
      header: 'Errors / Warnings',
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          {row.original.errorCount > 0 && (
            <ElementBadge variant="destructive">{row.original.errorCount} error{row.original.errorCount === 1 ? '' : 's'}</ElementBadge>
          )}
          {row.original.warningCount > 0 && (
            <ElementBadge variant="warning">{row.original.warningCount} warning{row.original.warningCount === 1 ? '' : 's'}</ElementBadge>
          )}
          {row.original.errorCount === 0 && row.original.warningCount === 0 && (
            <span className="text-sm text-muted-foreground">None</span>
          )}
        </div>
      ),
    },
    {
      id: 'lastSubmitted',
      header: 'Last submitted',
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatDateTime(row.original.lastSubmitted)}</span>,
    },
    {
      id: 'lastDownloaded',
      header: 'Last downloaded',
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatDateTime(row.original.lastDownloaded)}</span>,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <ElementTableButton.delete title="Delete" onClick={() => setDeleteTarget(row.original)} />
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-5">
      <ElementModal.Confirm
        isOpen={deleteTarget !== null}
        onClose={(v) => { if (!v) setDeleteTarget(null) }}
        variant="danger"
        title="Delete Sitemap"
        description={
          deleteTarget
            ? `Remove "${deleteTarget.path}" from Search Console? This only unregisters it from Google — the file itself keeps serving.`
            : undefined
        }
        confirmText="Delete"
        cancelText="Cancel"
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
      />

      <div>
        <h1 className="text-xl font-semibold">Sitemaps</h1>
        <p className="text-sm text-muted-foreground">
          Sitemaps submitted to Search Console for {data?.siteUrl || 'your site'}.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
        <div>
          <p className="text-sm font-semibold">Submit a sitemap</p>
          <p className="text-xs text-muted-foreground">
            A path on this site, e.g. /sitemap-index.xml — the main sitemap this site publishes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleSubmit()
            }}
            placeholder="/sitemap-index.xml"
            className="h-9 min-w-[280px] flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary"
          />
          <ElementButton size="sm" onClick={() => void handleSubmit()} disabled={isSubmitting}>
            <Send size={14} />
            {isSubmitting ? 'Submitting…' : 'Submit sitemap'}
          </ElementButton>
        </div>
        {submitError && <p className="text-sm text-destructive">{submitError}</p>}
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
          Loading sitemaps…
        </div>
      ) : !data || data.status === 'not_connected' ? (
        <EmptyState title="Search Console is not connected">
          {data?.reason ??
            'Connect Google Search Console under Settings → Integrations to manage sitemaps.'}
        </EmptyState>
      ) : sitemaps.length === 0 ? (
        <EmptyState title="No sitemaps submitted yet">
          Submit one above — the sitemap index at /sitemap-index.xml covers this whole blog.
        </EmptyState>
      ) : (
        <PaginatedDimensionTable<GscSitemapRow>
          columns={columns}
          rows={sitemaps}
          emptyContent={<p>No sitemaps submitted.</p>}
        />
      )}
    </div>
  )
}
