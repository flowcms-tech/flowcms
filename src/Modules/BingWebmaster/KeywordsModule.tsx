'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Search, PlugZap, TrendingUp } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import { KeywordsServices } from './Services/KeywordsServices'
import type { BingKeyword } from './Types/keywords'

/** The route caches for 6 hours — matches Search Console's Report screen. */
const STALE_TIME_MS = 6 * 60 * 60 * 1000

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-CA').format(Math.round(value))
}

function formatShortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { value?: number }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-background px-2.5 py-1.5 shadow-sm">
      <p className="text-[11px] text-muted-foreground">{label ? formatShortDate(label) : ''}</p>
      <p className="text-xs font-medium tabular-nums">{formatInteger(payload[0]?.value ?? 0)} impressions</p>
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

export default function KeywordsModule() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['bing-keywords', query],
    queryFn: () => KeywordsServices.keywords(query),
    enabled: query.length > 0,
    staleTime: STALE_TIME_MS,
  })

  const runSearch = (term: string) => {
    const trimmed = term.trim()
    if (trimmed) {
      setInput(trimmed)
      setQuery(trimmed)
    }
  }

  const relatedColumns: ExtendedColumnDef<BingKeyword>[] = [
    {
      id: 'query',
      accessorKey: 'query',
      header: 'Keyword',
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
      id: 'broadImpressions',
      header: 'Broad impressions',
      alignRight: true,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{formatInteger(row.original.broadImpressions)}</span>
      ),
    },
    {
      id: 'action',
      header: '',
      cell: ({ row }) => (
        <ElementButton size="sm" variant="ghost" onClick={() => runSearch(row.original.query)}>
          <Search size={12} />
          Search this
        </ElementButton>
      ),
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Keywords</h1>
        <p className="text-sm text-muted-foreground">
          Bing-wide keyword impression history and related keywords, pulled from Bing Webmaster
          Tools&apos; keyword research data — not scoped to a single site.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-4">
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') runSearch(input)
          }}
          placeholder="e.g. best running shoes"
          className="h-9 min-w-[280px] flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary"
        />
        <ElementButton size="sm" onClick={() => runSearch(input)} isLoading={isFetching}>
          <Search size={14} />
          Search
        </ElementButton>
      </div>

      {!query ? (
        <EmptyState icon={Search} title="Search for a keyword">
          Enter a keyword above to see its Bing impression history and related keyword suggestions.
        </EmptyState>
      ) : isLoading ? (
        <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
          Loading keyword data…
        </div>
      ) : !data || data.status === 'not_connected' ? (
        <EmptyState icon={PlugZap} title="Bing Webmaster Tools is not connected">
          {data?.reason ??
            'Connect Bing Webmaster Tools under Settings → Integrations to see keyword data here.'}
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} className="text-muted-foreground" />
              <p className="text-xs font-medium">Impressions for &quot;{data.query}&quot;</p>
            </div>
            {data.stats.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No impression history for this keyword.
              </p>
            ) : (
              <div className="h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={data.stats.filter((point) => point.date)}
                    margin={{ top: 4, right: 8, bottom: 0, left: -8 }}
                  >
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
                      content={<ChartTooltip />}
                    />
                    <Line
                      type="monotone"
                      dataKey="impressions"
                      stroke="var(--chart-1)"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)' }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="flex flex-col rounded-xl border border-border bg-background">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-medium">Related keywords</p>
            </div>
            <ElementTable<BingKeyword>
              columns={relatedColumns}
              data={data.related}
              emptyContent={<p>No related keywords found.</p>}
              classNames={{ container: 'rounded-none border-none shadow-none' }}
            />
          </div>
        </>
      )}
    </div>
  )
}
