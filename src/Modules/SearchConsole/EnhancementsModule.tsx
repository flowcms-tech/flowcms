'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PlugZap, Search as SearchIcon, RefreshCw, Sparkles, Info, ExternalLink, UserSearch } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import PaginatedDimensionTable from './Components/PaginatedDimensionTable'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import { SearchConsoleServices } from './Services/SearchConsoleServices'
import type { GscEnhancementRow, GscEnhancementPage } from './Types'

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

function EmptyState({ icon: Icon, title, children }: { icon: typeof PlugZap; title: string; children: React.ReactNode }) {
  const adminHref = useAdminHref()
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
      <Icon size={22} className="text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-xs leading-snug text-muted-foreground">{children}</p>
    </div>
  )
}

/** `adminHref` is passed in rather than hooked: this is a column factory, not
 *  a component. */
function pageColumns(adminHref: (sub?: string) => string): ExtendedColumnDef<GscEnhancementPage>[] {
  return [
    {
      id: 'url',
      accessorKey: 'url',
      header: 'Page',
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
      cell: ({ row }) =>
        row.original.valid ? (
          <ElementBadge variant="success">Valid</ElementBadge>
        ) : (
          <ElementBadge variant="destructive">Invalid</ElementBadge>
        ),
    },
  ]
}

export default function EnhancementsModule() {
  const adminHref = useAdminHref()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['gsc-enhancements'],
    queryFn: () => SearchConsoleServices.enhancements(),
    staleTime: STALE_TIME_MS,
  })

  const handleRefresh = async () => {
    const fresh = await SearchConsoleServices.enhancements(true)
    queryClient.setQueryData(['gsc-enhancements'], fresh)
  }

  const enhancements = data?.enhancements ?? []

  const typeColumns: ExtendedColumnDef<GscEnhancementRow>[] = [
    {
      id: 'type',
      accessorKey: 'type',
      header: 'Rich result type',
      cell: ({ row }) => <span className="text-sm font-medium">{row.original.type}</span>,
    },
    {
      id: 'valid',
      header: 'Valid pages',
      alignRight: true,
      cell: ({ row }) => (
        <ElementBadge variant="success">{row.original.validPages}</ElementBadge>
      ),
    },
    {
      id: 'invalid',
      header: 'Invalid pages',
      alignRight: true,
      cell: ({ row }) =>
        row.original.invalidPages > 0 ? (
          <ElementBadge variant="destructive">{row.original.invalidPages}</ElementBadge>
        ) : (
          <span className="text-sm text-muted-foreground">0</span>
        ),
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Enhancements</h1>
          <p className="text-sm text-muted-foreground">
            Rich result types detected across {data?.siteUrl || 'your site'}&apos;s known pages.
          </p>
        </div>
        {data?.status === 'ok' && (
          <ElementButton size="sm" variant="cancel" onClick={() => void handleRefresh()}>
            <RefreshCw size={14} />
            Re-check all
          </ElementButton>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info size={14} className="mt-0.5 shrink-0" />
        <p>
          Google&apos;s Search Console API has no dedicated Enhancements endpoint. This screen
          derives the same information from the Rich Results data already returned by the URL
          Inspection API — the same call Page Indexing makes — grouped by rich-result type across
          every known published page. A type appears here only once Google has detected structured
          data for it during inspection; a blank list does not mean nothing is marked up, only that
          nothing has been detected yet.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
          Inspecting pages — this calls Google once per post, so a first run can take a moment…
        </div>
      ) : !data || data.status === 'not_connected' ? (
        <EmptyState icon={PlugZap} title="Search Console is not connected">
          {data?.reason ??
            'Connect Google Search Console under Settings → Integrations to see enhancement data.'}
        </EmptyState>
      ) : data.status === 'no_pages' ? (
        <EmptyState icon={SearchIcon} title="No published posts yet">
          {data.reason}
        </EmptyState>
      ) : enhancements.length === 0 ? (
        <EmptyState icon={Sparkles} title="No rich results detected yet">
          None of your {data.inspectedCount} inspected page{data.inspectedCount === 1 ? '' : 's'} has
          structured data Google recognises as a rich result type. This updates as pages add
          FAQ, Article, or other supported schema markup.
        </EmptyState>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Checked {formatDateTime(data.checkedAt)} · {data.inspectedCount} of {data.totalKnownPages}{' '}
            known page{data.totalKnownPages === 1 ? '' : 's'} inspected.
          </p>
          <PaginatedDimensionTable<GscEnhancementRow>
            columns={typeColumns}
            rows={enhancements}
            emptyContent={<p>No rich result types detected.</p>}
            expandedRowContent={(row) => (
              <PaginatedDimensionTable<GscEnhancementPage>
                columns={pageColumns(adminHref)}
                rows={row.original.pages}
                emptyContent={<p>No pages.</p>}
              />
            )}
          />
        </>
      )}
    </div>
  )
}
