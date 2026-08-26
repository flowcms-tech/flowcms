'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Gauge, Search as SearchIcon, RefreshCw, ExternalLink, Info, KeyRound, UserSearch } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import PaginatedDimensionTable from './Components/PaginatedDimensionTable'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import { SearchConsoleServices } from './Services/SearchConsoleServices'
import type { CwvPageRow, CwvStrategy } from './Types'

const STALE_TIME_MS = 24 * 60 * 60 * 1000

function categoryBadge(category: string | null) {
  if (category === 'FAST') return <ElementBadge variant="success">Good</ElementBadge>
  if (category === 'AVERAGE') return <ElementBadge variant="warning">Needs improvement</ElementBadge>
  if (category === 'SLOW') return <ElementBadge variant="destructive">Poor</ElementBadge>
  return <ElementBadge variant="muted">No data</ElementBadge>
}

function formatMs(value: number | null): string {
  if (value === null) return '—'
  return `${(value / 1000).toFixed(2)}s`
}

function formatCls(value: number | null): string {
  if (value === null) return '—'
  return value.toFixed(3)
}

function formatDateTime(iso: string | null): string {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function EmptyState({ icon: Icon, title, children }: { icon: typeof Gauge; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
      <Icon size={22} className="text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-xs leading-snug text-muted-foreground">{children}</p>
    </div>
  )
}

function ResultCard({ row }: { row: CwvPageRow }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <a
          href={row.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {row.url}
          <ExternalLink size={12} />
        </a>
        {categoryBadge(row.overallCategory)}
      </div>
      {row.error ? (
        <p className="text-sm text-destructive">{row.error}</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground">LCP</span>
            <span className="text-sm">{formatMs(row.lcp.percentile)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground">CLS</span>
            <span className="text-sm">{formatCls(row.cls.percentile !== null ? row.cls.percentile / 100 : null)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground">INP</span>
            <span className="text-sm">{formatMs(row.inp.percentile)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground">Performance score</span>
            <span className="text-sm">{row.performanceScore !== null ? Math.round(row.performanceScore * 100) : '—'}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function CoreWebVitalsModule() {
  const adminHref = useAdminHref()
  const queryClient = useQueryClient()
  const [strategy, setStrategy] = useState<CwvStrategy>('mobile')
  const [isRechecking, setIsRechecking] = useState(false)
  const [testUrlInput, setTestUrlInput] = useState('')
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<CwvPageRow | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['gsc-core-web-vitals', strategy],
    queryFn: () => SearchConsoleServices.coreWebVitals(strategy),
    staleTime: STALE_TIME_MS,
  })

  const handleRecheckAll = async () => {
    setIsRechecking(true)
    try {
      const fresh = await SearchConsoleServices.coreWebVitals(strategy, true)
      queryClient.setQueryData(['gsc-core-web-vitals', strategy], fresh)
    } finally {
      setIsRechecking(false)
    }
  }

  const handleTest = async () => {
    if (!testUrlInput.trim()) return
    setIsTesting(true)
    setTestError(null)
    try {
      const result = await SearchConsoleServices.testCoreWebVitals(testUrlInput.trim(), strategy)
      setTestResult(result)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string | string[] } } }
      const raw = axiosErr.response?.data?.message
      setTestError(Array.isArray(raw) ? raw.join(', ') : raw || 'Could not run PageSpeed Insights for this URL.')
      setTestResult(null)
    } finally {
      setIsTesting(false)
    }
  }

  const pages = data?.pages ?? []

  const columns: ExtendedColumnDef<CwvPageRow>[] = [
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
      id: 'category',
      header: 'Status',
      cell: ({ row }) => (row.original.error ? <ElementBadge variant="destructive">Error</ElementBadge> : categoryBadge(row.original.overallCategory)),
    },
    {
      id: 'lcp',
      header: 'LCP',
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatMs(row.original.lcp.percentile)}</span>,
    },
    {
      id: 'cls',
      header: 'CLS',
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatCls(row.original.cls.percentile !== null ? row.original.cls.percentile / 100 : null)}</span>,
    },
    {
      id: 'inp',
      header: 'INP',
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatMs(row.original.inp.percentile)}</span>,
    },
    {
      id: 'score',
      header: 'Performance score',
      alignRight: true,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {row.original.performanceScore !== null ? Math.round(row.original.performanceScore * 100) : '—'}
        </span>
      ),
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Core Web Vitals</h1>
          <p className="text-sm text-muted-foreground">
            Real-user and lab performance metrics from PageSpeed Insights.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5">
            <button
              type="button"
              onClick={() => setStrategy('mobile')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${strategy === 'mobile' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            >
              Mobile
            </button>
            <button
              type="button"
              onClick={() => setStrategy('desktop')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${strategy === 'desktop' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            >
              Desktop
            </button>
          </div>
          {data?.status === 'ok' && (
            <ElementButton size="sm" variant="cancel" onClick={() => void handleRecheckAll()} disabled={isRechecking}>
              <RefreshCw size={14} className={isRechecking ? 'animate-spin' : undefined} />
              {isRechecking ? 'Re-checking…' : 'Re-check all'}
            </ElementButton>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info size={14} className="mt-0.5 shrink-0" />
        <p>
          Core Web Vitals aren&apos;t part of the Search Console API — this screen calls the
          separate PageSpeed Insights API, which needs its own API key (Settings → Integrations).
          Field data (real visitors, 28-day rolling average) shows &quot;No data&quot; for
          low-traffic pages; lab data (a single simulated Lighthouse run) is always shown alongside it.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
          Running PageSpeed Insights — each page takes several seconds, so a first run can take a while…
        </div>
      ) : !data || data.status === 'not_configured' ? (
        <EmptyState icon={KeyRound} title="PageSpeed Insights is not configured">
          {data?.reason ?? 'Add an API key under Settings → Integrations to see Core Web Vitals.'}
        </EmptyState>
      ) : data.status === 'no_pages' ? (
        <EmptyState icon={SearchIcon} title="No published posts yet">
          {data.reason}
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-success/30 bg-success-light p-4">
              <p className="text-sm font-medium text-success">Good</p>
              <p className="mt-1 text-3xl font-semibold text-success">{data.goodCount}</p>
            </div>
            <div className="rounded-xl border border-warning/30 bg-warning-light p-4">
              <p className="text-sm font-medium text-warning">Needs improvement</p>
              <p className="mt-1 text-3xl font-semibold text-warning">{data.needsImprovementCount}</p>
            </div>
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
              <p className="text-sm font-medium text-destructive">Poor</p>
              <p className="mt-1 text-3xl font-semibold text-destructive">{data.poorCount}</p>
            </div>
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <p className="text-sm font-medium text-muted-foreground">Checked</p>
              <p className="mt-1 text-sm">{formatDateTime(data.checkedAt)}</p>
              {data.erroredCount > 0 && (
                <p className="mt-1 text-xs text-destructive">{data.erroredCount} couldn&apos;t be tested</p>
              )}
            </div>
          </div>

          {data.inspectedCount < data.totalKnownPages && (
            <p className="text-xs text-warning">
              Tested the first {data.inspectedCount} of {data.totalKnownPages} known published posts
              this run.
            </p>
          )}

          <PaginatedDimensionTable<CwvPageRow>
            columns={columns}
            rows={pages}
            emptyContent={<p>No pages tested.</p>}
            expandedRowContent={(row) => <ResultCard row={row.original} />}
          />
        </>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
        <div>
          <p className="text-sm font-semibold">Test any URL</p>
          <p className="text-xs text-muted-foreground">
            Check a page outside the list above, using the {strategy} strategy.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={testUrlInput}
            onChange={(event) => setTestUrlInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleTest()
            }}
            placeholder="/blog/some-post or a full URL"
            className="h-9 min-w-[280px] flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary"
          />
          <ElementButton size="sm" onClick={() => void handleTest()} disabled={isTesting}>
            <Gauge size={14} />
            {isTesting ? 'Testing…' : 'Test'}
          </ElementButton>
        </div>
        {testError && <p className="text-sm text-destructive">{testError}</p>}
        {testResult && <ResultCard row={testResult} />}
      </div>
    </div>
  )
}
