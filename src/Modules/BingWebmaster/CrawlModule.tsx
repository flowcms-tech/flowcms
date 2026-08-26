'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts'
import { Bot, ShieldAlert } from 'lucide-react'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import PaginatedDimensionTable from '@/Modules/SearchConsole/Components/PaginatedDimensionTable'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import { CrawlServices } from './Services/CrawlServices'
import type { BingCrawlStats, BingCrawlIssue } from './Types/crawl'

const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${i}:00`)

function formatShortDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
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
      <p className="text-xs font-medium tabular-nums">{payload[0]?.value ?? 0} crawled pages</p>
    </div>
  )
}

function CrawlVolumeChart({ stats }: { stats: BingCrawlStats[] }) {
  const data = [...stats].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-4">
      <p className="text-xs font-medium">Crawled pages, last 6 months</p>
      <div className="h-[200px] w-full">
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
            <Tooltip cursor={{ stroke: 'var(--border)', strokeWidth: 1 }} content={<ChartTooltip />} />
            <Line
              type="monotone"
              dataKey="crawledPages"
              stroke="var(--chart-1)"
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

/** Bing does not publish the bit values for the Issues flags field in its
 *  current docs (only one worked example maps a raw code to "Contains
 *  Malware"), so this shows HTTP code and the raw code rather than a
 *  guessed set of flag names. */
function issueBadge(issue: BingCrawlIssue) {
  if (issue.httpCode >= 500) return <ElementBadge variant="destructive">Server error ({issue.httpCode})</ElementBadge>
  if (issue.httpCode >= 400) return <ElementBadge variant="warning">Client error ({issue.httpCode})</ElementBadge>
  return <ElementBadge variant="muted">Code {issue.issuesCode}</ElementBadge>
}

function CrawlRateForm({
  initialRate,
  onSave,
  isSaving,
}: {
  initialRate: number[]
  onSave: (rate: number[]) => void
  isSaving: boolean
}) {
  // No effect needed to resync when `initialRate` changes server-side — the
  // call site keys this component on the settings identity, so React
  // remounts it (fresh `useState`) instead of us syncing state in an effect.
  const [rate, setRate] = useState<number[]>(initialRate)

  const setHour = (hour: number, value: number) => {
    setRate((prev) => prev.map((v, i) => (i === hour ? value : v)))
  }

  const dirty = JSON.stringify(rate) !== JSON.stringify(initialRate)

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium">Crawl rate by hour of day</p>
          <p className="text-[11px] text-muted-foreground">
            1 (slowest) to 10 (fastest), one value per hour. Bing&apos;s default is 5 for every hour.
          </p>
        </div>
        <ElementButton
          type="button"
          size="sm"
          onClick={() => onSave(rate)}
          disabled={!dirty}
          isLoading={isSaving}
        >
          Save
        </ElementButton>
      </div>
      <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
        {rate.map((value, hour) => (
          <div key={hour} className="flex flex-col items-center gap-1">
            <span className="text-[10px] text-muted-foreground">{HOUR_LABELS[hour]}</span>
            <input
              type="number"
              min={1}
              max={10}
              value={value}
              onChange={(e) => setHour(hour, Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
              className="w-12 rounded-md border border-border bg-background px-1 py-1 text-center text-xs tabular-nums"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function CrawlModule() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['bing-crawl'],
    queryFn: CrawlServices.crawl,
  })

  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async (crawlRate: number[]) => {
    setIsSaving(true)
    try {
      const updated = await CrawlServices.updateCrawlSettings({ crawlRate })
      queryClient.setQueryData(['bing-crawl'], updated)
    } catch {
      return
    } finally {
      setIsSaving(false)
    }
  }

  const columns: ExtendedColumnDef<BingCrawlIssue>[] = [
    {
      id: 'url',
      accessorKey: 'url',
      header: 'URL',
      cell: ({ row }) => (
        <a
          href={row.original.url}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary"
        >
          {row.original.url}
        </a>
      ),
    },
    {
      id: 'issue',
      header: 'Issue',
      cell: ({ row }) => issueBadge(row.original),
    },
    {
      id: 'inLinks',
      accessorKey: 'inLinks',
      header: 'Inbound links',
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.inLinks}</span>,
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Crawl</h1>
        <p className="text-sm text-muted-foreground">
          Crawl volume, issues Bing found while crawling this site, and crawl rate settings.
        </p>
      </div>

      {isLoading || !data ? (
        <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : data.status === 'not_connected' ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
          <Bot size={22} className="text-muted-foreground" />
          <p className="text-sm font-medium">Bing Webmaster Tools is not connected</p>
          <p className="max-w-md text-xs leading-snug text-muted-foreground">{data.reason}</p>
        </div>
      ) : (
        <>
          <CrawlVolumeChart stats={data.stats} />

          {data.settings && (
            <CrawlRateForm
              key={JSON.stringify(data.settings.crawlRate)}
              initialRate={data.settings.crawlRate}
              onSave={handleSave}
              isSaving={isSaving}
            />
          )}

          {data.issues.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
              <ShieldAlert size={22} className="text-muted-foreground" />
              <p className="text-sm font-medium">No crawl issues</p>
              <p className="max-w-md text-xs leading-snug text-muted-foreground">
                Bing hasn&apos;t reported any crawl issues for this site. It can take a few days for a
                fixed issue to disappear from Bing&apos;s own list once resolved.
              </p>
            </div>
          ) : (
            <PaginatedDimensionTable<BingCrawlIssue>
              columns={columns}
              rows={data.issues}
              emptyContent={<p>No crawl issues.</p>}
            />
          )}
        </>
      )}
    </div>
  )
}
