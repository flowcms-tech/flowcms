'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  PlugZap,
  RefreshCw,
  ExternalLink,
  Search as SearchIcon,
  Info,
  UserSearch,
} from 'lucide-react'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import PaginatedDimensionTable from './Components/PaginatedDimensionTable'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import { SearchConsoleServices } from './Services/SearchConsoleServices'
import type { GscIndexingReasonRow, GscUrlInspectionRow } from './Types'

/** Inspections are cached 24h server-side — matches that here so a tab left
 *  open all day doesn't silently refetch the exact same snapshot. */
const STALE_TIME_MS = 24 * 60 * 60 * 1000

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

/** Google's enum values arrive SCREAMING_SNAKE_CASE ("ROBOTS_TXT_STATE_ALLOWED",
 *  "SUBMITTED_AND_INDEXED") — this is the one place that vocabulary gets
 *  translated into something readable, so every column can just call it. */
function prettifyEnum(value: string | null): string {
  if (!value) return '—'
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function statusBadge(row: GscUrlInspectionRow) {
  if (row.error) return <ElementBadge variant="destructive">Error</ElementBadge>
  if (row.indexed) return <ElementBadge variant="success">Indexed</ElementBadge>
  return <ElementBadge variant="warning">Not indexed</ElementBadge>
}

function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof PlugZap
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
      <Icon size={22} className="text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-xs leading-snug text-muted-foreground">{children}</p>
    </div>
  )
}

/** The full deep-dive field set for one URL — shared by the per-page table's
 *  row detail and the ad-hoc inspector result, so a URL reads identically
 *  whichever path found it. */
function InspectionDetail({ row }: { row: GscUrlInspectionRow }) {
  if (row.error) {
    return <p className="text-sm text-destructive">{row.error}</p>
  }

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Coverage state" value={row.coverageState ?? '—'} />
      <Field label="Verdict" value={prettifyEnum(row.verdict)} />
      <Field label="Robots.txt" value={prettifyEnum(row.robotsTxtState)} />
      <Field label="Indexing" value={prettifyEnum(row.indexingState)} />
      <Field label="Page fetch" value={prettifyEnum(row.pageFetchState)} />
      <Field label="Last crawled" value={formatDateTime(row.lastCrawlTime)} />
      <Field label="Your canonical" value={row.userCanonical ?? 'Not declared'} mono />
      <Field
        label="Google's canonical"
        value={row.googleCanonical ?? '—'}
        mono
        warn={row.canonicalMismatch}
      />
      <Field
        label="Mobile usability"
        value={`${prettifyEnum(row.mobileUsabilityVerdict)}${row.mobileUsabilityIssueCount ? ` (${row.mobileUsabilityIssueCount} issue${row.mobileUsabilityIssueCount === 1 ? '' : 's'})` : ''}`}
        warn={row.mobileUsabilityIssueCount > 0}
      />
      <Field
        label="Rich results"
        value={row.richResultsTypeCount ? `${row.richResultsTypeCount} type${row.richResultsTypeCount === 1 ? '' : 's'} detected` : 'None detected'}
      />
      {row.canonicalMismatch && (
        <p className="col-span-full text-xs text-warning">
          Google indexed a different URL as canonical than the one this page declares — the
          content is likely being treated as a duplicate of that other URL instead of ranking on
          its own.
        </p>
      )}
      {row.inspectionResultLink && (
        <a
          href={row.inspectionResultLink}
          target="_blank"
          rel="noreferrer"
          className="col-span-full inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline"
        >
          Open full inspection in Search Console
          <ExternalLink size={11} />
        </a>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  mono,
  warn,
}: {
  label: string
  value: string
  mono?: boolean
  warn?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span
        className={`text-sm ${mono ? 'break-all font-mono text-xs' : ''} ${warn ? 'font-medium text-warning' : ''}`}
      >
        {value}
      </span>
    </div>
  )
}

function ReasonsTable({ reasons, erroredCount }: { reasons: GscIndexingReasonRow[]; erroredCount: number }) {
  const columns: ExtendedColumnDef<GscIndexingReasonRow>[] = [
    {
      id: 'reason',
      accessorKey: 'reason',
      header: 'Reason',
      cell: ({ row }) => <span className="text-sm font-medium">{row.original.reason}</span>,
    },
    {
      id: 'source',
      header: 'Source',
      cell: ({ row }) => (
        <ElementBadge variant={row.original.source === 'Website' ? 'warning' : 'muted'}>
          {row.original.source}
        </ElementBadge>
      ),
    },
    {
      id: 'pages',
      header: 'Pages',
      alignRight: true,
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.pages}</span>,
    },
  ]

  return (
    <ElementTable<GscIndexingReasonRow>
      columns={columns}
      data={reasons}
      emptyContent={
        <p>
          {erroredCount > 0
            ? `${erroredCount} page${erroredCount === 1 ? '' : 's'} could not be inspected (see errors in the table below) — nothing else to explain.`
            : 'Every inspected page is indexed — nothing to explain.'}
        </p>
      }
      expandedRowContent={(row) => (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">
            {row.original.pages} affected page{row.original.pages === 1 ? '' : 's'}:
          </p>
          {row.original.urls.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="w-fit truncate text-xs text-primary hover:underline"
            >
              {url}
            </a>
          ))}
        </div>
      )}
    />
  )
}

export default function PageIndexingModule() {
  const adminHref = useAdminHref()
  const queryClient = useQueryClient()
  const [inspectUrlInput, setInspectUrlInput] = useState('')
  const [isInspecting, setIsInspecting] = useState(false)
  const [isRechecking, setIsRechecking] = useState(false)
  const [adHocResult, setAdHocResult] = useState<GscUrlInspectionRow | null>(null)
  const [adHocError, setAdHocError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['gsc-page-indexing'],
    queryFn: () => SearchConsoleServices.pageIndexing(),
    staleTime: STALE_TIME_MS,
  })

  // Not a plain refetch: the query's own cache key always hits the 24h
  // server-side cache. "Re-check all" needs to bypass that (the `refresh`
  // param), so it fetches directly and writes the result into the query
  // cache itself rather than asking react-query to re-run the same request.
  const handleRecheckAll = async () => {
    setIsRechecking(true)
    try {
      const fresh = await SearchConsoleServices.pageIndexing(true)
      queryClient.setQueryData(['gsc-page-indexing'], fresh)
    } finally {
      setIsRechecking(false)
    }
  }

  const handleInspect = async () => {
    if (!inspectUrlInput.trim()) return
    setIsInspecting(true)
    setAdHocError(null)
    try {
      const result = await SearchConsoleServices.inspectUrl(inspectUrlInput.trim())
      setAdHocResult(result)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string | string[] } } }
      const raw = axiosErr.response?.data?.message
      setAdHocError(Array.isArray(raw) ? raw.join(', ') : raw || 'Could not inspect this URL.')
      setAdHocResult(null)
    } finally {
      setIsInspecting(false)
    }
  }

  const pages = data?.pages ?? []

  const pageColumns: ExtendedColumnDef<GscUrlInspectionRow>[] = [
    {
      id: 'url',
      accessorKey: 'url',
      header: 'URL',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <a
            href={row.original.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <span className="max-w-sm truncate">{row.original.url.replace(/^https?:\/\//, '')}</span>
            <ExternalLink size={12} className="shrink-0" />
          </a>
          <Link
            href={adminHref(`/search-console/pages?url=${encodeURIComponent(row.original.url)}`)}
            title="View profile"
            className="text-muted-foreground hover:text-primary"
          >
            <UserSearch size={13} />
          </Link>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => statusBadge(row.original),
    },
    {
      id: 'reason',
      header: 'Reason',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.coverageState ?? '—'}</span>
      ),
    },
    {
      id: 'canonical',
      header: 'Canonical',
      cell: ({ row }) =>
        row.original.canonicalMismatch ? (
          <ElementBadge variant="warning">Mismatch</ElementBadge>
        ) : (
          <span className="text-sm text-muted-foreground">Match</span>
        ),
    },
    {
      id: 'mobile',
      header: 'Mobile',
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{prettifyEnum(row.original.mobileUsabilityVerdict)}</span>,
    },
    {
      id: 'lastCrawled',
      header: 'Last crawled',
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatDateTime(row.original.lastCrawlTime)}</span>,
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Page Indexing</h1>
          <p className="text-sm text-muted-foreground">
            Live per-page indexing diagnostics for {data?.siteUrl || 'your site'}.
          </p>
        </div>
        {data?.status === 'ok' && (
          <ElementButton size="sm" variant="cancel" onClick={() => void handleRecheckAll()} disabled={isRechecking}>
            <RefreshCw size={14} className={isRechecking ? 'animate-spin' : undefined} />
            {isRechecking ? 'Re-checking…' : 'Re-check all'}
          </ElementButton>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info size={14} className="mt-0.5 shrink-0" />
        <p>
          Google doesn&apos;t expose its bulk Index Coverage report (the historical chart and
          property-wide counts shown in the Search Console UI) through any API — only live,
          one-URL-at-a-time inspection. This screen runs that inspection across every published
          post this app knows about and builds the same kind of breakdown from the results, so the
          numbers below are a fresh snapshot of your own known pages, not a historical trend across
          every URL Google has ever crawled.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
          Inspecting pages — this calls Google once per post, so a first run can take a moment…
        </div>
      ) : !data || data.status === 'not_connected' ? (
        <EmptyState icon={PlugZap} title="Search Console is not connected">
          {data?.reason ??
            'Connect Google Search Console under Settings → Integrations to inspect your pages.'}
        </EmptyState>
      ) : data.status === 'no_pages' ? (
        <EmptyState icon={SearchIcon} title="No published posts yet">
          {data.reason}
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <p className="text-sm font-medium text-muted-foreground">Not indexed</p>
              <p className="mt-1 text-3xl font-semibold">{data.notIndexedCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.reasons.length} reason{data.reasons.length === 1 ? '' : 's'}
              </p>
            </div>
            <div className="rounded-xl border border-success/30 bg-success-light p-4">
              <p className="text-sm font-medium text-success">Indexed</p>
              <p className="mt-1 text-3xl font-semibold text-success">{data.indexedCount}</p>
              <p className="mt-1 text-xs text-success/80">
                Checked {formatDateTime(data.checkedAt)}
              </p>
            </div>
            {data.erroredCount > 0 && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
                <p className="text-sm font-medium text-destructive">Couldn&apos;t inspect</p>
                <p className="mt-1 text-3xl font-semibold text-destructive">{data.erroredCount}</p>
                <p className="mt-1 text-xs text-destructive/80">
                  Not counted as indexed or not — see the table below for why.
                </p>
              </div>
            )}
          </div>

          {data.inspectedCount < data.totalKnownPages && (
            <p className="text-xs text-warning">
              Inspected the first {data.inspectedCount} of {data.totalKnownPages} known published
              posts this run — the rest weren&apos;t checked to protect the daily inspection quota.
            </p>
          )}

          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold">Why pages aren&apos;t indexed</p>
            <ReasonsTable reasons={data.reasons} erroredCount={data.erroredCount} />
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold">Every inspected page</p>
            <PaginatedDimensionTable<GscUrlInspectionRow>
              columns={pageColumns}
              rows={pages}
              emptyContent={<p>No pages inspected.</p>}
              expandedRowContent={(row) => <InspectionDetail row={row.original} />}
            />
          </div>
        </>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
        <div>
          <p className="text-sm font-semibold">Inspect any URL</p>
          <p className="text-xs text-muted-foreground">
            Check a page outside the list above — an old redirected URL, a service page, anything
            on this property.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={inspectUrlInput}
            onChange={(event) => setInspectUrlInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleInspect()
            }}
            placeholder="/blog/some-post or a full URL"
            className="h-9 min-w-[280px] flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary"
          />
          <ElementButton size="sm" onClick={() => void handleInspect()} disabled={isInspecting}>
            <SearchIcon size={14} />
            {isInspecting ? 'Inspecting…' : 'Inspect'}
          </ElementButton>
        </div>
        {adHocError && <p className="text-sm text-destructive">{adHocError}</p>}
        {adHocResult && (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <a
                href={adHocResult.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                {adHocResult.url}
                <ExternalLink size={12} />
              </a>
              {statusBadge(adHocResult)}
            </div>
            <InspectionDetail row={adHocResult} />
          </div>
        )}
      </div>
    </div>
  )
}
