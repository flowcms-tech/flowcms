'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PlugZap, ExternalLink, Send } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ElementDrawer from '@/components/shared/ElementDrawer/ElementDrawer'
import ElementTableButton from '@/components/shared/ElementTable/TableActionsButton/ElementTableButton'
import PaginatedDimensionTable from '@/Modules/SearchConsole/Components/PaginatedDimensionTable'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import { SitemapsServices } from './Services/SitemapsServices'
import type { BingFeed } from './Types/sitemaps'

function formatDateTime(iso: string | null): string {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
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

function statusVariant(status: string): 'success' | 'destructive' | 'warning' | 'muted' {
  const normalized = status.toLowerCase()
  if (normalized === 'success') return 'success'
  if (normalized.includes('error')) return 'destructive'
  if (normalized.includes('warn')) return 'warning'
  return 'muted'
}

export default function SitemapsModule() {
  const queryClient = useQueryClient()
  const [feedUrlInput, setFeedUrlInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BingFeed | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [detailsTarget, setDetailsTarget] = useState<BingFeed | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['bing-sitemaps'],
    queryFn: () => SitemapsServices.sitemaps(),
  })

  const detailsQuery = useQuery({
    queryKey: ['bing-feed-details', detailsTarget?.url],
    queryFn: () => SitemapsServices.feedDetails(detailsTarget!.url),
    enabled: detailsTarget !== null,
  })

  const invalidate = (fresh: Awaited<ReturnType<typeof SitemapsServices.sitemaps>>) =>
    queryClient.setQueryData(['bing-sitemaps'], fresh)

  const handleSubmit = async () => {
    if (!feedUrlInput.trim()) return
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const fresh = await SitemapsServices.submitSitemap(feedUrlInput.trim())
      invalidate(fresh)
      setFeedUrlInput('')
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
      const fresh = await SitemapsServices.removeSitemap(deleteTarget.url)
      invalidate(fresh)
      setDeleteTarget(null)
    } catch {
      return
    } finally {
      setIsDeleting(false)
    }
  }

  const feeds = data?.feeds ?? []

  const columns: ExtendedColumnDef<BingFeed>[] = [
    {
      id: 'url',
      accessorKey: 'url',
      header: 'URL',
      cell: ({ row }) => (
        <a
          href={row.original.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <span className="max-w-sm truncate">{row.original.url.replace(/^https?:\/\//, '')}</span>
          <ExternalLink size={12} className="shrink-0" />
        </a>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.type}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <ElementBadge variant={statusVariant(row.original.status)}>{row.original.status}</ElementBadge>
      ),
    },
    {
      id: 'urlCount',
      header: 'URLs',
      alignRight: true,
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.urlCount}</span>,
    },
    {
      id: 'lastCrawled',
      header: 'Last crawled',
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatDateTime(row.original.lastCrawled)}</span>,
    },
    {
      id: 'submitted',
      header: 'Submitted',
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatDateTime(row.original.submitted)}</span>,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <ElementButton size="sm" variant="outline" onClick={() => setDetailsTarget(row.original)}>
            Details
          </ElementButton>
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
        title="Remove Sitemap"
        description={
          deleteTarget
            ? `Remove "${deleteTarget.url}" from Bing Webmaster Tools? This only unregisters it from Bing — the file itself keeps serving.`
            : undefined
        }
        confirmText="Remove"
        cancelText="Cancel"
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
      />

      <ElementDrawer
        isOpen={detailsTarget !== null}
        setIsOpen={(open) => { if (!open) setDetailsTarget(null) }}
        headerLabel={detailsTarget ? detailsTarget.url : 'Feed details'}
        size="md"
      >
        {detailsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !detailsQuery.data || detailsQuery.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No child feeds — this is a single sitemap, not a sitemap index.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {detailsQuery.data.map((child) => (
              <div key={child.url} className="rounded-lg border border-border p-3 text-sm">
                <p className="truncate font-medium">{child.url}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <ElementBadge variant={statusVariant(child.status)}>{child.status}</ElementBadge>
                  <span>{child.urlCount} URLs</span>
                  <span>Last crawled {formatDateTime(child.lastCrawled)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </ElementDrawer>

      <div>
        <h1 className="text-xl font-semibold">Sitemaps</h1>
        <p className="text-sm text-muted-foreground">
          Sitemaps submitted to Bing Webmaster Tools for {data?.siteUrl || 'your site'}.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
        <div>
          <p className="text-sm font-semibold">Submit a sitemap</p>
          <p className="text-xs text-muted-foreground">
            The full URL of a sitemap, RSS/Atom feed, or text file this site publishes, e.g.
            https://flowcms.tech/sitemap.xml
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={feedUrlInput}
            onChange={(event) => setFeedUrlInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleSubmit()
            }}
            placeholder="https://flowcms.tech/sitemap.xml"
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
        <EmptyState title="Bing Webmaster Tools is not connected">
          {data?.reason ??
            'Connect Bing Webmaster Tools under Settings → Integrations to manage sitemaps.'}
        </EmptyState>
      ) : feeds.length === 0 ? (
        <EmptyState title="No sitemaps submitted yet">
          Submit one above — the sitemap index this site already publishes for Google works for Bing too.
        </EmptyState>
      ) : (
        <PaginatedDimensionTable<BingFeed>
          columns={columns}
          rows={feeds}
          emptyContent={<p>No sitemaps submitted.</p>}
        />
      )}
    </div>
  )
}
