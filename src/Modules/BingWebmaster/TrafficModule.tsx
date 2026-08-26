'use client'

import { useState } from 'react'
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
import type { Row } from '@tanstack/react-table'
import { PlugZap, ExternalLink, RefreshCw } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementTabs from '@/components/shared/ElementTabs/ElementTabs'
import ElementSelect from '@/components/shared/ElementSelect/ElementSelect'
import PaginatedDimensionTable from './Components/PaginatedDimensionTable'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import { TrafficServices } from './Services/TrafficServices'
import type { BingQueryStat, BingPageStat, BingRankAndTrafficStat } from './Types/traffic'

const STALE_TIME_MS = 6 * 60 * 60 * 1000

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-CA').format(Math.round(value))
}

function formatShortDate(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(`${iso}T00:00:00Z`)
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-background p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold leading-none">{value}</p>
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
      <p className="text-[11px] text-muted-foreground">{formatShortDate(label ?? null)}</p>
      <p className="text-xs font-medium tabular-nums">
        {formatInteger(payload[0]?.value ?? 0)} {seriesLabel}
      </p>
    </div>
  )
}

/** One measure per plot, small multiples sharing an x-axis — same reasoning
 *  as the Search Console dashboard: clicks and impressions differ by orders
 *  of magnitude, so a shared dual-axis chart would imply a false scale. */
function MetricChart({
  data,
  dataKey,
  label,
  color,
}: {
  data: BingRankAndTrafficStat[]
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
      <div className="h-[180px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="var(--border)" strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => formatShortDate(value)}
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

/** Query × page drill-in for a Top Queries row — the "detail" side of
 *  GetQueryPageDetailStats. Pick which top page to cross-reference, since
 *  Bing's own API takes both a query and a page, not just one. */
function QueryDetailPanel({ query, topPages }: { query: string; topPages: BingPageStat[] }) {
  const [page, setPage] = useState<string>(topPages[0]?.pageUrl ?? '')

  const { data, isFetching } = useQuery({
    queryKey: ['bing-query-page-detail', query, page],
    queryFn: () => TrafficServices.queryPageDetail(query, page),
    enabled: !!page,
    staleTime: STALE_TIME_MS,
  })

  if (topPages.length === 0) {
    return <p className="p-3 text-xs text-muted-foreground">No pages available to cross-reference.</p>
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Page:</span>
        <ElementSelect
          name="bing-query-detail-page"
          value={page}
          onValueChange={(value) => setPage(value as string)}
          items={topPages.map((p) => ({ label: p.pageUrl, value: p.pageUrl }))}
          className="max-w-md"
        />
      </div>
      {isFetching ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : !data || data.length === 0 ? (
        <p className="text-xs text-muted-foreground">No detail rows for this query/page pair.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-4 font-normal">Date</th>
              <th className="py-1 pr-4 font-normal">Clicks</th>
              <th className="py-1 pr-4 font-normal">Impressions</th>
              <th className="py-1 font-normal">Position</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={`${row.date}-${i}`} className="border-t border-border">
                <td className="py-1 pr-4">{formatShortDate(row.date)}</td>
                <td className="py-1 pr-4 tabular-nums">{formatInteger(row.clicks)}</td>
                <td className="py-1 pr-4 tabular-nums">{formatInteger(row.impressions)}</td>
                <td className="py-1 tabular-nums">{row.position.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function TrafficModule() {
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['bing-traffic'],
    queryFn: TrafficServices.traffic,
    staleTime: STALE_TIME_MS,
  })

  const topPages = data?.topPages ?? []

  const queryColumns: ExtendedColumnDef<BingQueryStat>[] = [
    { id: 'query', accessorKey: 'query', header: 'Query', cell: ({ row }) => <span className="text-sm">{row.original.query}</span> },
    { id: 'impressions', header: 'Impressions', alignRight: true, cell: ({ row }) => <span className="text-sm tabular-nums">{formatInteger(row.original.impressions)}</span> },
    { id: 'clicks', header: 'Clicks', alignRight: true, cell: ({ row }) => <span className="text-sm tabular-nums">{formatInteger(row.original.clicks)}</span> },
    { id: 'avgClickPosition', header: 'Avg. click position', alignRight: true, cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.avgClickPosition.toFixed(1)}</span> },
    { id: 'avgImpressionPosition', header: 'Avg. impression position', alignRight: true, cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.avgImpressionPosition.toFixed(1)}</span> },
  ]

  const pageColumns: ExtendedColumnDef<BingPageStat>[] = [
    {
      id: 'pageUrl',
      accessorKey: 'pageUrl',
      header: 'Page',
      cell: ({ row }) => (
        <a href={row.original.pageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <span className="max-w-md truncate">{row.original.pageUrl}</span>
          <ExternalLink size={12} className="shrink-0" />
        </a>
      ),
    },
    { id: 'impressions', header: 'Impressions', alignRight: true, cell: ({ row }) => <span className="text-sm tabular-nums">{formatInteger(row.original.impressions)}</span> },
    { id: 'clicks', header: 'Clicks', alignRight: true, cell: ({ row }) => <span className="text-sm tabular-nums">{formatInteger(row.original.clicks)}</span> },
    { id: 'avgClickPosition', header: 'Avg. click position', alignRight: true, cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.avgClickPosition.toFixed(1)}</span> },
  ]

  const totalClicks = (data?.series ?? []).reduce((sum, row) => sum + row.clicks, 0)
  const totalImpressions = (data?.series ?? []).reduce((sum, row) => sum + row.impressions, 0)

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Traffic & Rank</h1>
          <p className="text-sm text-muted-foreground">
            Search performance for {data?.siteUrl || 'your site'}, pulled from Bing Webmaster Tools.
          </p>
        </div>
        {data?.status === 'ok' && (
          <ElementButton size="sm" variant="cancel" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw size={14} />
            Refresh
          </ElementButton>
        )}
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
          Loading Bing Webmaster data…
        </div>
      ) : !data || data.status === 'not_connected' ? (
        <EmptyState icon={PlugZap} title="Bing Webmaster Tools is not connected">
          {data?.reason ?? 'Connect Bing Webmaster Tools under Settings → Integrations to see search performance here.'}
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-2">
            <StatTile label="Clicks" value={formatInteger(totalClicks)} />
            <StatTile label="Impressions" value={formatInteger(totalImpressions)} />
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <MetricChart data={data.series} dataKey="clicks" label="Clicks" color="var(--chart-1)" />
            <MetricChart data={data.series} dataKey="impressions" label="Impressions" color="var(--chart-2)" />
          </div>

          <ElementTabs items={[{ value: 'queries', label: 'Queries' }, { value: 'pages', label: 'Pages' }]} defaultValue="queries">
            <ElementTabs.Content value="queries">
              <PaginatedDimensionTable<BingQueryStat>
                columns={queryColumns}
                rows={data.topQueries}
                emptyContent={<p>No queries reported for this site.</p>}
                expandedRowContent={(row: Row<BingQueryStat>) => (
                  <QueryDetailPanel query={row.original.query} topPages={topPages} />
                )}
              />
            </ElementTabs.Content>
            <ElementTabs.Content value="pages">
              <PaginatedDimensionTable<BingPageStat>
                columns={pageColumns}
                rows={data.topPages}
                emptyContent={<p>No pages reported for this site.</p>}
              />
            </ElementTabs.Content>
          </ElementTabs>
        </>
      )}
    </div>
  )
}
