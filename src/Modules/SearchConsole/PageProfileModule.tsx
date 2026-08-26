'use client'

import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Search, FileSearch, Zap, Link2, ShieldAlert } from 'lucide-react'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import { SearchConsoleServices } from './Services/SearchConsoleServices'
import type { CwvPageRow } from './Types'

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

function Card({ icon: Icon, title, children }: { icon: typeof Search; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-muted-foreground" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function NotAvailable({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}

function CwvBlock({ label, row }: { label: string; row: CwvPageRow | null }) {
  if (!row) return <NotAvailable>No {label} data — PageSpeed Insights not configured or not yet run for this page.</NotAvailable>
  if (row.error) return <p className="text-xs text-destructive">{row.error}</p>
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {categoryBadge(row.overallCategory)}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] text-muted-foreground">LCP</span>
          <span className="text-sm">{formatMs(row.lcp.percentile)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] text-muted-foreground">INP</span>
          <span className="text-sm">{formatMs(row.inp.percentile)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] text-muted-foreground">Score</span>
          <span className="text-sm">{row.performanceScore !== null ? Math.round(row.performanceScore * 100) : '—'}</span>
        </div>
      </div>
    </div>
  )
}

interface PageProfileModuleProps {
  postId?: string
  url?: string
}

export default function PageProfileModule({ postId, url }: PageProfileModuleProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['gsc-page-profile', postId ?? url],
    queryFn: () => SearchConsoleServices.pageProfile(postId ? { postId } : { url: url! }),
    enabled: !!postId || !!url,
  })

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
        Loading page profile…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
        <Search size={22} className="text-muted-foreground" />
        <p className="text-sm font-medium">Couldn&apos;t load this page&apos;s profile</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">{data.title ?? 'Page Profile'}</h1>
        <a
          href={data.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {data.url}
          <ExternalLink size={12} />
        </a>
        {!data.postId && (
          <p className="mt-1 text-xs text-muted-foreground">
            Not a post this app tracks — some sections below aren&apos;t available.
          </p>
        )}
      </div>

      <Card icon={Search} title="Search performance (last 90 days)">
        {data.performance ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] text-muted-foreground">Clicks</span>
              <span className="text-lg font-semibold">{data.performance.totals.clicks}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] text-muted-foreground">Impressions</span>
              <span className="text-lg font-semibold">{data.performance.totals.impressions}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] text-muted-foreground">CTR</span>
              <span className="text-lg font-semibold">{(data.performance.totals.ctr * 100).toFixed(1)}%</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] text-muted-foreground">Avg. position</span>
              <span className="text-lg font-semibold">{data.performance.totals.position.toFixed(1)}</span>
            </div>
          </div>
        ) : (
          <NotAvailable>Search Console is not connected.</NotAvailable>
        )}
      </Card>

      <Card icon={FileSearch} title="Indexing">
        {data.inspection ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] text-muted-foreground">Status</span>
              <span className="text-sm">
                {data.inspection.indexed ? (
                  <ElementBadge variant="success">Indexed</ElementBadge>
                ) : (
                  <ElementBadge variant="warning">{data.inspection.coverageState ?? 'Not indexed'}</ElementBadge>
                )}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] text-muted-foreground">Canonical</span>
              <span className="text-sm">
                {data.inspection.canonicalMismatch ? (
                  <ElementBadge variant="destructive">Mismatch</ElementBadge>
                ) : (
                  <ElementBadge variant="success">Matches</ElementBadge>
                )}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] text-muted-foreground">Rich results</span>
              <span className="text-sm">{data.inspection.richResultsTypeCount} type{data.inspection.richResultsTypeCount === 1 ? '' : 's'}</span>
            </div>
          </div>
        ) : (
          <NotAvailable>Not inspected — Search Console is not connected, or this URL isn&apos;t part of the configured property.</NotAvailable>
        )}
      </Card>

      <Card icon={Zap} title="Core Web Vitals">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <CwvBlock label="Mobile" row={data.coreWebVitals.mobile} />
          <CwvBlock label="Desktop" row={data.coreWebVitals.desktop} />
        </div>
      </Card>

      <Card icon={Link2} title="Links">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Internal inbound links</p>
            {data.internalInbound ? (
              <p className="text-sm">
                {data.internalInbound.inboundCount} link{data.internalInbound.inboundCount === 1 ? '' : 's'} from{' '}
                {data.internalInbound.sources.map((s) => s.title).join(', ')}
              </p>
            ) : (
              <NotAvailable>No other post links to this page.</NotAvailable>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">External outbound links</p>
            {data.externalOutbound.length > 0 ? (
              <ul className="flex flex-col gap-0.5">
                {data.externalOutbound.map((link) => (
                  <li key={link} className="truncate text-sm text-primary">
                    <a href={link} target="_blank" rel="noreferrer" className="hover:underline">{link}</a>
                  </li>
                ))}
              </ul>
            ) : (
              <NotAvailable>This page links to no external sites.</NotAvailable>
            )}
          </div>
        </div>
      </Card>

      <Card icon={ShieldAlert} title="Related issues">
        {data.relatedIssues.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {data.relatedIssues.map((issue) => (
              <li key={issue.id} className="flex items-center gap-2 text-sm">
                <ElementBadge variant={issue.status === 'open' ? 'destructive' : 'success'}>
                  {issue.status === 'open' ? 'Open' : 'Resolved'}
                </ElementBadge>
                {issue.title}
              </li>
            ))}
          </ul>
        ) : (
          <NotAvailable>No manual actions or security issues logged for this URL.</NotAvailable>
        )}
      </Card>
    </div>
  )
}
