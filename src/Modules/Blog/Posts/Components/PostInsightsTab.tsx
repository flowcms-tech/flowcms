'use client'

import { useQuery } from '@tanstack/react-query'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ExternalLink, PlugZap, RefreshCw, Clock } from 'lucide-react'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import { PostInsightsServices } from '../Services/PostInsightsServices'
import PostContentGaps from './PostContentGaps'
import type { InsightsDayPoint, InsightsQueryRow } from '../Types/insights'

/**
 * Search Console performance for one post.
 *
 * NOT WIRED INTO THE EDIT MODULE — this component is imported nowhere on
 * purpose; the post edit screen adds the tab separately.
 *
 * The route caches for 6 hours, so `staleTime` here matches: re-requesting
 * inside that window can only ever return the same cached body.
 */
const STALE_TIME_MS = 6 * 60 * 60 * 1000

/**
 * Days of the post's life that Google's finalised window has to cover before a
 * blank panel means anything. Under this, "no impressions" is a statement about
 * the reporting lag, not about the post.
 *
 * Measured against the response's own `endDate` rather than the clock, so this
 * stays a pure function of the data — and so it uses the same reference date
 * the numbers above it were computed from.
 */
const MIN_COVERED_DAYS = 1

function daysCovered(publishedAt: string, endDate: string): number | null {
  const published = new Date(publishedAt).getTime()
  const end = new Date(`${endDate}T23:59:59Z`).getTime()
  if (Number.isNaN(published) || Number.isNaN(end)) return null
  return (end - published) / 86_400_000
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-CA').format(Math.round(value))
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function formatShortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-background p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      {/* Proportional figures, not tabular — these are standalone display
          numbers, not a column that has to align vertically. */}
      <p className="text-xl font-semibold leading-none">{value}</p>
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  )
}

function ChartTooltip({
  active,
  payload,
  label,
  seriesLabel,
}: {
  active?: boolean
  payload?: { value?: number }[]
  label?: string
  seriesLabel: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-background px-2.5 py-1.5 shadow-sm">
      <p className="text-[11px] text-muted-foreground">{label ? formatShortDate(label) : ''}</p>
      <p className="text-xs font-medium tabular-nums">
        {formatInteger(payload[0]?.value ?? 0)} {seriesLabel}
      </p>
    </div>
  )
}

/**
 * One measure per plot, stacked as small multiples sharing an x-axis.
 *
 * Deliberately NOT one chart with two y-axes. Clicks and impressions differ by
 * two orders of magnitude, and the alignment between two independent scales is
 * arbitrary — a dual-axis plot invents a correlation the data does not contain.
 * Two plots read the same shape without asserting anything false.
 */
function MetricChart({
  data,
  dataKey,
  label,
  color,
}: {
  data: InsightsDayPoint[]
  dataKey: 'clicks' | 'impressions'
  label: string
  color: string
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-4">
      <div className="flex items-center gap-2">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <p className="text-xs font-medium">{label}</p>
      </div>
      {/* Height includes the x-axis band, so the axis labels are never cropped
          into a nested scrollbar. */}
      <div className="h-[168px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="var(--border)" strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatShortDate}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={44}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
              content={<ChartTooltip seriesLabel={label.toLowerCase()} />}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)' }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
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

export interface PostInsightsTabProps {
  /** Site-relative path of the published post, e.g. `/blog/rekey-vs-replace`.
   *  The route resolves it against the configured base URL. */
  pagePath: string
  /** Null for an unpublished post. Used only to tell "too new for Google to
   *  have data" apart from "genuinely gets no impressions". */
  publishedAt?: string | null
  isPublished?: boolean
  /** Current editor content, for the content-gap comparison. Live form state is
   *  correct here — the gaps should reflect what is about to be saved. */
  content: string
  title?: string
  metaDescription?: string
}

export default function PostInsightsTab({
  pagePath,
  publishedAt,
  isPublished = true,
  content,
  title,
  metaDescription,
}: PostInsightsTabProps) {
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['post-insights', pagePath],
    queryFn: () => PostInsightsServices.pagePerformance(pagePath),
    staleTime: STALE_TIME_MS,
    enabled: isPublished && !!pagePath,
  })

  // No useMemo: two date parses, and the React Compiler memoizes the component
  // anyway.
  const covered = publishedAt && data?.endDate ? daysCovered(publishedAt, data.endDate) : null

  const columns: ExtendedColumnDef<InsightsQueryRow>[] = [
    {
      id: 'query',
      accessorKey: 'query',
      header: 'Query',
      cell: ({ row }) => <span className="text-sm">{row.original.query}</span>,
    },
    {
      id: 'impressions',
      header: 'Impressions',
      alignRight: true,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{formatInteger(row.original.impressions)}</span>
      ),
    },
    {
      id: 'clicks',
      header: 'Clicks',
      alignRight: true,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{formatInteger(row.original.clicks)}</span>
      ),
    },
    {
      id: 'ctr',
      header: 'CTR',
      alignRight: true,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{formatPercent(row.original.ctr)}</span>
      ),
    },
    {
      id: 'position',
      header: 'Position',
      alignRight: true,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{row.original.position.toFixed(1)}</span>
      ),
    },
  ]

  if (!isPublished) {
    return (
      <EmptyState icon={Clock} title="Not published yet">
        Search Console only reports on pages Google can reach. Publish the post and check
        back in a few days.
      </EmptyState>
    )
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
        Loading Search Console data…
      </div>
    )
  }

  // Three distinct empty states, because each one calls for a completely
  // different response: fix the integration, wait, or rewrite the post.
  if (!data || data.status === 'not_connected') {
    return (
      <EmptyState icon={PlugZap} title="Search Console is not connected">
        {data?.reason ??
          'Connect Google Search Console under Settings → Integrations to see what this post ranks for.'}
      </EmptyState>
    )
  }

  if (data.status === 'no_data' && covered !== null && covered < MIN_COVERED_DAYS) {
    const ageDays = Math.max(0, Math.floor(covered + data.lagDays))
    return (
      <EmptyState icon={Clock} title="Too new for data">
        This post is about {ageDays} day{ageDays === 1 ? '' : 's'} old, and Search Console
        finalises data around {data.lagDays} days behind — its reporting window ends{' '}
        {data.endDate}, before this post had been live for a full day. Nothing is wrong; check
        back in a few days.
      </EmptyState>
    )
  }

  if (data.status === 'no_data') {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState icon={ExternalLink} title="No impressions in the last 90 days">
          Google has data for this property but has not shown this page for any search.
          Usually that means the post is not indexed yet, is targeting a phrase nothing
          searches for, or is being outranked so far down that it never renders. Check the
          URL below matches the property exactly: <span className="font-mono">{data.pageUrl}</span>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {data.startDate} to {data.endDate} · Search Console finalises data about{' '}
          {data.lagDays} days late, so today and yesterday are never shown.
        </p>
        <ElementButton
          size="sm"
          variant="cancel"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RefreshCw size={14} />
          Refresh
        </ElementButton>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Clicks" value={formatInteger(data.totals.clicks)} />
        <StatTile label="Impressions" value={formatInteger(data.totals.impressions)} />
        <StatTile label="Average CTR" value={formatPercent(data.totals.ctr)} />
        <StatTile
          label="Average position"
          value={data.totals.position.toFixed(1)}
          hint="Lower is better"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <MetricChart data={data.series} dataKey="clicks" label="Clicks" color="var(--chart-1)" />
        <MetricChart
          data={data.series}
          dataKey="impressions"
          label="Impressions"
          color="var(--chart-2)"
        />
      </div>

      {/* Doubles as the table view for the charts above — every number the
          plots encode is also readable as text. */}
      <ElementTable<InsightsQueryRow>
        columns={columns}
        data={data.queries}
        headerContent={
          <div>
            <p className="text-sm font-semibold">Top queries</p>
            <p className="text-xs text-muted-foreground">
              The 25 searches with the most impressions for this page, highest first.
            </p>
          </div>
        }
        emptyContent={<p>No queries reported for this page.</p>}
      />

      <PostContentGaps
        queries={data.queries}
        content={content}
        title={title}
        metaDescription={metaDescription}
      />
    </div>
  )
}
