'use client'

import { useQuery } from '@tanstack/react-query'
import type { Row } from '@tanstack/react-table'
import { Link2, ExternalLink } from 'lucide-react'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import { BacklinksServices } from './Services/BacklinksServices'
import type { BingBacklinksLinkRow } from './Types/backlinks'

function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
      <Link2 size={22} className="text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-xs leading-snug text-muted-foreground">{children}</p>
    </div>
  )
}

function UrlLinksDetail({ url }: { url: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['bing-url-links', url],
    queryFn: () => BacklinksServices.urlLinks(url),
  })

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Loading inbound links…</p>
  }
  if (!data || data.details.length === 0) {
    return <p className="text-xs text-muted-foreground">No inbound link detail available.</p>
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">Linking pages:</p>
      {data.details.map((detail, index) => (
        <a
          key={`${detail.url}-${index}`}
          href={detail.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {detail.url}
          <span className="text-xs text-muted-foreground">({detail.anchorText || 'no anchor text'})</span>
          <ExternalLink size={12} />
        </a>
      ))}
    </div>
  )
}

export default function BacklinksModule() {
  const { data, isLoading } = useQuery({
    queryKey: ['bing-backlinks'],
    queryFn: () => BacklinksServices.backlinks(),
  })

  const columns: ExtendedColumnDef<BingBacklinksLinkRow>[] = [
    {
      id: 'url',
      accessorKey: 'url',
      header: 'Page',
      cell: ({ row }) => (
        <a
          href={row.original.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {row.original.url}
          <ExternalLink size={12} />
        </a>
      ),
    },
    {
      id: 'count',
      header: 'Inbound links',
      alignRight: true,
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.count}</span>,
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Backlinks</h1>
        <p className="text-sm text-muted-foreground">
          Pages Bing has found with inbound links to this site. Expand a row to see the actual
          linking URLs.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : !data || data.status === 'not_connected' ? (
        <EmptyState title="Bing Webmaster Tools is not connected">
          {data?.reason ?? 'Connect it under Settings → Integrations to see backlink data.'}
        </EmptyState>
      ) : (
        <>
          <ElementTable<BingBacklinksLinkRow>
            columns={columns}
            data={data.links}
            emptyContent={<p>No inbound links found for this site yet.</p>}
            expandedRowContent={(row: Row<BingBacklinksLinkRow>) => <UrlLinksDetail url={row.original.url} />}
          />

          <div className="flex flex-col gap-3 border-t border-border pt-5">
            <h2 className="text-sm font-semibold">Connected Pages</h2>
            {data.connectedPages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No connected pages reported by Bing.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.connectedPages.map((page) => (
                  <a
                    key={page.url}
                    href={page.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground hover:underline"
                  >
                    {page.url}
                    <ExternalLink size={11} />
                  </a>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
