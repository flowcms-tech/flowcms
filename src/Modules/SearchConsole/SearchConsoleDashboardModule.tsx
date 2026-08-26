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
import { PlugZap, RefreshCw, ExternalLink } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementTabs from '@/components/shared/ElementTabs/ElementTabs'
import { ElementRangeDatePicker } from '@/components/shared/ElementDatePicker/ElementDatePicker'
import PaginatedDimensionTable from './Components/PaginatedDimensionTable'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import { SearchConsoleServices } from './Services/SearchConsoleServices'
import {
  WINDOW_DAY_OPTIONS,
  DEFAULT_WINDOW_DAYS,
  type WindowDays,
  type GscRangeSelection,
  type GscDayPoint,
  type GscQueryRow,
  type GscPageRow,
  type GscCountryRow,
  type GscDeviceRow,
  type GscSearchAppearanceRow,
  type GscDateRow,
} from './Types'

/** Common ISO 3166-1 alpha-3 codes GSC reports, mapped to a display name.
 *  Not exhaustive — anything missing falls back to the uppercased code
 *  rather than a blank cell, so an unmapped country is still legible. */
const COUNTRY_NAMES: Record<string, string> = {
  usa: 'United States', can: 'Canada', gbr: 'United Kingdom', aus: 'Australia', deu: 'Germany',
  fra: 'France', ind: 'India', bra: 'Brazil', mex: 'Mexico', esp: 'Spain', ita: 'Italy',
  nld: 'Netherlands', rus: 'Russia', chn: 'China', jpn: 'Japan', kor: 'South Korea',
  idn: 'Indonesia', pak: 'Pakistan', nga: 'Nigeria', bgd: 'Bangladesh', vnm: 'Vietnam',
  phl: 'Philippines', tur: 'Turkey', irn: 'Iran', tha: 'Thailand', zaf: 'South Africa',
  egy: 'Egypt', pol: 'Poland', ukr: 'Ukraine', arg: 'Argentina', dza: 'Algeria',
  sau: 'Saudi Arabia', uzb: 'Uzbekistan', mys: 'Malaysia', per: 'Peru', mar: 'Morocco',
  afg: 'Afghanistan', col: 'Colombia', irq: 'Iraq', sdn: 'Sudan', npl: 'Nepal',
  ven: 'Venezuela', mmr: 'Myanmar', uga: 'Uganda', kaz: 'Kazakhstan', ken: 'Kenya',
  ago: 'Angola', gha: 'Ghana', prk: 'North Korea', syr: 'Syria', tza: 'Tanzania',
  lka: 'Sri Lanka', mdg: 'Madagascar', civ: 'Ivory Coast', cmr: 'Cameroon', prt: 'Portugal',
  grc: 'Greece', swe: 'Sweden', nor: 'Norway', fin: 'Finland', dnk: 'Denmark',
  che: 'Switzerland', aut: 'Austria', bel: 'Belgium', irl: 'Ireland', nzl: 'New Zealand',
  sgp: 'Singapore', isr: 'Israel', are: 'United Arab Emirates', hkg: 'Hong Kong', twn: 'Taiwan',
  chl: 'Chile', cze: 'Czech Republic', rou: 'Romania', hun: 'Hungary', bgr: 'Bulgaria',
  hrv: 'Croatia', srb: 'Serbia', svk: 'Slovakia', svn: 'Slovenia', ltu: 'Lithuania',
  lva: 'Latvia', est: 'Estonia', isl: 'Iceland', lux: 'Luxembourg', mlt: 'Malta', cyp: 'Cyprus',
}

const WINDOW_LABELS: Record<WindowDays, string> = {
  7: 'Last 7 days',
  28: 'Last 28 days',
  90: 'Last 3 months',
}

/** The route caches for 6 hours, so `staleTime` matches: re-requesting inside
 *  that window can only ever return the same cached body. */
const STALE_TIME_MS = 6 * 60 * 60 * 1000

function toYMD(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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

function formatFullDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function countryName(code: string): string {
  return COUNTRY_NAMES[code.toLowerCase()] ?? code.toUpperCase()
}

function deviceLabel(device: string): string {
  const lower = device.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function searchAppearanceLabel(value: string): string {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

interface MetricRow extends Record<string, unknown> {
  impressions: number
  clicks: number
  ctr: number
  position: number
}

/** The impressions/clicks/CTR/position columns every dimension table shares
 *  — only the first column (query, page, country, …) differs between them. */
function metricColumns<T extends MetricRow>(): ExtendedColumnDef<T>[] {
  return [
    {
      id: 'impressions',
      header: 'Impressions',
      alignRight: true,
      cell: ({ row }) => <span className="text-sm tabular-nums">{formatInteger(row.original.impressions)}</span>,
    },
    {
      id: 'clicks',
      header: 'Clicks',
      alignRight: true,
      cell: ({ row }) => <span className="text-sm tabular-nums">{formatInteger(row.original.clicks)}</span>,
    },
    {
      id: 'ctr',
      header: 'CTR',
      alignRight: true,
      cell: ({ row }) => <span className="text-sm tabular-nums">{formatPercent(row.original.ctr)}</span>,
    },
    {
      id: 'position',
      header: 'Position',
      alignRight: true,
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.position.toFixed(1)}</span>,
    },
  ]
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-background p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      {/* Proportional figures, not tabular — standalone display numbers, not
          a column that has to align vertically. */}
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
 */
function MetricChart({
  data,
  dataKey,
  label,
  color,
}: {
  data: GscDayPoint[]
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

export default function SearchConsoleDashboardModule() {
  const [days, setDays] = useState<WindowDays>(DEFAULT_WINDOW_DAYS)
  const [isCustom, setIsCustom] = useState(false)
  const [customRange, setCustomRange] = useState<{ startDate: Date | null; endDate: Date | null }>({
    startDate: null,
    endDate: null,
  })

  const hasCompleteCustomRange = !!(customRange.startDate && customRange.endDate)
  const range: GscRangeSelection =
    isCustom && customRange.startDate && customRange.endDate
      ? { kind: 'custom', startDate: toYMD(customRange.startDate), endDate: toYMD(customRange.endDate) }
      : { kind: 'preset', days }

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['gsc-site-dashboard', range],
    queryFn: () => SearchConsoleServices.siteDashboard(range),
    // A "Custom" toggle with no range picked yet has nothing to fetch —
    // firing anyway would just re-run the last preset's query under a
    // different key, showing stale data behind an empty-looking picker.
    enabled: !isCustom || hasCompleteCustomRange,
    staleTime: STALE_TIME_MS,
  })

  const queryColumns: ExtendedColumnDef<GscQueryRow>[] = [
    {
      id: 'query',
      accessorKey: 'query',
      header: 'Query',
      cell: ({ row }) => <span className="text-sm">{row.original.query}</span>,
    },
    ...metricColumns<GscQueryRow>(),
  ]

  const pageColumns: ExtendedColumnDef<GscPageRow>[] = [
    {
      id: 'page',
      accessorKey: 'page',
      header: 'Page',
      cell: ({ row }) => (
        <a
          href={row.original.page}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <span className="max-w-md truncate">{row.original.page}</span>
          <ExternalLink size={12} className="shrink-0" />
        </a>
      ),
    },
    ...metricColumns<GscPageRow>(),
  ]

  const countryColumns: ExtendedColumnDef<GscCountryRow>[] = [
    {
      id: 'country',
      accessorKey: 'country',
      header: 'Country',
      cell: ({ row }) => <span className="text-sm">{countryName(row.original.country)}</span>,
    },
    ...metricColumns<GscCountryRow>(),
  ]

  const deviceColumns: ExtendedColumnDef<GscDeviceRow>[] = [
    {
      id: 'device',
      accessorKey: 'device',
      header: 'Device',
      cell: ({ row }) => <span className="text-sm">{deviceLabel(row.original.device)}</span>,
    },
    ...metricColumns<GscDeviceRow>(),
  ]

  const searchAppearanceColumns: ExtendedColumnDef<GscSearchAppearanceRow>[] = [
    {
      id: 'searchAppearance',
      accessorKey: 'searchAppearance',
      header: 'Search appearance',
      cell: ({ row }) => <span className="text-sm">{searchAppearanceLabel(row.original.searchAppearance)}</span>,
    },
    ...metricColumns<GscSearchAppearanceRow>(),
  ]

  const dateColumns: ExtendedColumnDef<GscDateRow>[] = [
    {
      id: 'date',
      accessorKey: 'date',
      header: 'Date',
      cell: ({ row }) => <span className="text-sm">{formatFullDate(row.original.date)}</span>,
    },
    ...metricColumns<GscDateRow>(),
  ]

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Search Console</h1>
          <p className="text-sm text-muted-foreground">
            Search performance for {data?.siteUrl || 'your site'}, pulled from Google Search Console.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
            {WINDOW_DAY_OPTIONS.map((option) => (
              <ElementButton
                key={option}
                type="button"
                size="sm"
                variant={!isCustom && days === option ? 'primary' : 'ghost'}
                onClick={() => {
                  setIsCustom(false)
                  setDays(option)
                }}
              >
                {WINDOW_LABELS[option]}
              </ElementButton>
            ))}
            <ElementButton
              type="button"
              size="sm"
              variant={isCustom ? 'primary' : 'ghost'}
              onClick={() => setIsCustom(true)}
            >
              Custom
            </ElementButton>
          </div>

          {isCustom && (
            <ElementRangeDatePicker
              showPresets={false}
              placeholder="Pick a date range"
              startDate={customRange.startDate}
              endDate={customRange.endDate}
              onChange={({ startDate, endDate }) => setCustomRange({ startDate, endDate })}
            />
          )}

          {data?.status === 'ok' && (
            <ElementButton size="sm" variant="cancel" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw size={14} />
              Refresh
            </ElementButton>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
          Loading Search Console data…
        </div>
      ) : !data || data.status === 'not_connected' ? (
        <EmptyState icon={PlugZap} title="Search Console is not connected">
          {data?.reason ??
            'Connect Google Search Console under Settings → Integrations to see search performance here.'}
        </EmptyState>
      ) : data.status === 'no_data' ? (
        <EmptyState
          icon={ExternalLink}
          title={`No impressions ${isCustom ? 'in the selected range' : `in the ${WINDOW_LABELS[days].toLowerCase()}`}`}
        >
          Google has data for this property but has not shown any of its pages for a search in this
          window. That usually means the site is new to Google, or the connected property doesn&apos;t
          match the site being served.
        </EmptyState>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {data.startDate} to {data.endDate} · Search Console finalises data about {data.lagDays} days
            late, so today and yesterday are never shown.
          </p>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
            <MetricChart data={data.series} dataKey="impressions" label="Impressions" color="var(--chart-2)" />
          </div>

          <ElementTabs
            items={[
              { value: 'queries', label: 'Queries' },
              { value: 'pages', label: 'Pages' },
              { value: 'countries', label: 'Countries' },
              { value: 'devices', label: 'Devices' },
              { value: 'searchAppearance', label: 'Search Appearance' },
              { value: 'days', label: 'Days' },
            ]}
            defaultValue="queries"
          >
            <ElementTabs.Content value="queries">
              <PaginatedDimensionTable<GscQueryRow>
                columns={queryColumns}
                rows={data.topQueries}
                emptyContent={<p>No queries reported for this property.</p>}
              />
            </ElementTabs.Content>
            <ElementTabs.Content value="pages">
              <PaginatedDimensionTable<GscPageRow>
                columns={pageColumns}
                rows={data.topPages}
                emptyContent={<p>No pages reported for this property.</p>}
              />
            </ElementTabs.Content>
            <ElementTabs.Content value="countries">
              <PaginatedDimensionTable<GscCountryRow>
                columns={countryColumns}
                rows={data.topCountries}
                emptyContent={<p>No countries reported for this property.</p>}
              />
            </ElementTabs.Content>
            <ElementTabs.Content value="devices">
              <PaginatedDimensionTable<GscDeviceRow>
                columns={deviceColumns}
                rows={data.topDevices}
                emptyContent={<p>No devices reported for this property.</p>}
              />
            </ElementTabs.Content>
            <ElementTabs.Content value="searchAppearance">
              <PaginatedDimensionTable<GscSearchAppearanceRow>
                columns={searchAppearanceColumns}
                rows={data.topSearchAppearances}
                emptyContent={<p>No search appearance data reported for this property.</p>}
              />
            </ElementTabs.Content>
            <ElementTabs.Content value="days">
              <PaginatedDimensionTable<GscDateRow>
                columns={dateColumns}
                rows={data.byDate}
                emptyContent={<p>No days reported for this property.</p>}
              />
            </ElementTabs.Content>
          </ElementTabs>
        </>
      )}
    </div>
  )
}
