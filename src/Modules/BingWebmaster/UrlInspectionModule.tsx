'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlugZap, Search as SearchIcon, ExternalLink } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import { UrlInspectionServices } from './Services/UrlInspectionServices'
import type { BingUrlProfile } from './Types/urlInspection'

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

function httpStatusBadge(httpStatus: number | null) {
  if (httpStatus === null) return <ElementBadge variant="muted">Unknown</ElementBadge>
  if (httpStatus >= 200 && httpStatus < 300) return <ElementBadge variant="success">{httpStatus}</ElementBadge>
  if (httpStatus === 0) return <ElementBadge variant="muted">Not crawled</ElementBadge>
  return <ElementBadge variant="destructive">{httpStatus}</ElementBadge>
}

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

function UrlProfileCard({ profile }: { profile: BingUrlProfile }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <a
          href={profile.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {profile.url}
          <ExternalLink size={12} />
        </a>
        {httpStatusBadge(profile.httpStatus)}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Field label="Clicks" value={profile.clicks ?? '—'} />
        <Field label="Impressions" value={profile.impressions ?? '—'} />
        <Field label="Anchor count" value={profile.anchorCount ?? '—'} />
        <Field label="Document size" value={profile.documentSize ?? '—'} />
        <Field label="Discovered" value={formatDateTime(profile.discoveryDate)} />
        <Field label="Last crawled" value={formatDateTime(profile.lastCrawledDate)} />
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}

export default function UrlInspectionModule() {
  const [input, setInput] = useState('')
  const [lookupUrl, setLookupUrl] = useState('')

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['bing-url-inspection', lookupUrl],
    queryFn: () => UrlInspectionServices.inspect(lookupUrl),
    enabled: !!lookupUrl,
  })

  const childColumns: ExtendedColumnDef<BingUrlProfile>[] = [
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
      id: 'status',
      header: 'HTTP status',
      cell: ({ row }) => httpStatusBadge(row.original.httpStatus),
    },
    {
      id: 'clicks',
      header: 'Clicks',
      alignRight: true,
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.clicks ?? '—'}</span>,
    },
    {
      id: 'impressions',
      header: 'Impressions',
      alignRight: true,
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.impressions ?? '—'}</span>,
    },
    {
      id: 'lastCrawled',
      header: 'Last crawled',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{formatDateTime(row.original.lastCrawledDate)}</span>
      ),
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">URL Inspection</h1>
        <p className="text-sm text-muted-foreground">
          Look up a single page or a whole directory&apos;s index and traffic status on Bing.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-4">
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && input.trim()) setLookupUrl(input.trim())
          }}
          placeholder="https://flowcms.tech/blog/some-post or https://flowcms.tech/blog/"
          className="h-9 min-w-[280px] flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary"
        />
        <ElementButton size="sm" onClick={() => input.trim() && setLookupUrl(input.trim())} disabled={isFetching}>
          <SearchIcon size={14} />
          {isFetching ? 'Inspecting…' : 'Inspect'}
        </ElementButton>
      </div>

      {!lookupUrl ? (
        <EmptyState icon={SearchIcon} title="Nothing inspected yet">
          Enter a page URL for a single-page report, or a directory URL (ending in /) to see every
          page Bing has indexed underneath it.
        </EmptyState>
      ) : isLoading ? (
        <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
          Inspecting…
        </div>
      ) : !data || data.status === 'not_connected' ? (
        <EmptyState icon={PlugZap} title="Bing Webmaster Tools is not connected">
          {data?.reason ??
            'Connect Bing Webmaster Tools under Settings → Integrations to inspect URLs.'}
        </EmptyState>
      ) : data.kind === 'page' && data.page ? (
        <UrlProfileCard profile={data.page} />
      ) : data.kind === 'directory' ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">
            {data.children.length} page{data.children.length === 1 ? '' : 's'} under this directory
          </p>
          <ElementTable<BingUrlProfile>
            columns={childColumns}
            data={data.children}
            emptyContent={<p>No child pages found under this directory.</p>}
          />
        </div>
      ) : (
        <EmptyState icon={SearchIcon} title="No data">
          Bing has no information for this URL yet.
        </EmptyState>
      )}
    </div>
  )
}
