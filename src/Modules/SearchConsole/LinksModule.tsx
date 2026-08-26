'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Search as SearchIcon, Info, ExternalLink, AlertTriangle, UserSearch } from 'lucide-react'
import ElementTabs from '@/components/shared/ElementTabs/ElementTabs'
import PaginatedDimensionTable from './Components/PaginatedDimensionTable'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import { SearchConsoleServices } from './Services/SearchConsoleServices'
import type { ExternalLinkRow, InternalLinkRow, InternalLinkSource } from './Types'

function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  const adminHref = useAdminHref()
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
      <SearchIcon size={22} className="text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-xs leading-snug text-muted-foreground">{children}</p>
    </div>
  )
}

/** `adminHref` is passed in rather than hooked: this is a column factory, not
 *  a component. */
function sourceColumns(adminHref: (sub?: string) => string): ExtendedColumnDef<InternalLinkSource>[] {
  return [
    {
      id: 'title',
      accessorKey: 'title',
      header: 'Linking post',
      cell: ({ row }) => (
        <a
          href={adminHref(`/blog/posts/${row.original.id}/edit`)}
          className="text-sm text-primary hover:underline"
        >
          {row.original.title}
        </a>
      ),
    },
  ]
}

export default function LinksModule() {
  const adminHref = useAdminHref()
  const { data, isLoading } = useQuery({
    queryKey: ['gsc-links-report'],
    queryFn: () => SearchConsoleServices.linksReport(),
  })

  const internalColumns: ExtendedColumnDef<InternalLinkRow>[] = [
    {
      id: 'target',
      accessorKey: 'targetTitle',
      header: 'Post',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <a
            href={adminHref(`/blog/posts/${row.original.targetId}/edit`)}
            className="text-sm font-medium text-primary hover:underline"
          >
            {row.original.targetTitle}
          </a>
          <Link
            href={adminHref(`/search-console/page/${row.original.targetId}`)}
            title="View profile"
            className="text-muted-foreground hover:text-primary"
          >
            <UserSearch size={13} />
          </Link>
        </div>
      ),
    },
    {
      id: 'inboundCount',
      header: 'Inbound internal links',
      alignRight: true,
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.inboundCount}</span>,
    },
  ]

  const externalColumns: ExtendedColumnDef<ExternalLinkRow>[] = [
    {
      id: 'domain',
      accessorKey: 'domain',
      header: 'Domain',
      cell: ({ row }) => (
        <a
          href={row.original.urls[0]}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {row.original.domain}
          <ExternalLink size={12} />
        </a>
      ),
    },
    {
      id: 'count',
      header: 'Links',
      alignRight: true,
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.count}</span>,
    },
    {
      id: 'sourcePosts',
      header: 'Linked from',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.sourcePosts.length} post{row.original.sourcePosts.length === 1 ? '' : 's'}
        </span>
      ),
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Links</h1>
        <p className="text-sm text-muted-foreground">
          Internal and external links across every published post.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info size={14} className="mt-0.5 shrink-0" />
        <p>
          Google does not provide an API for link data — this report is computed by scanning this
          site&apos;s own published post content, not fetched from Search Console.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : !data || data.status === 'no_pages' ? (
        <EmptyState title="No published posts yet">
          There&apos;s nothing to scan for links until at least one post is published.
        </EmptyState>
      ) : (
        <>
          {data.zeroInboundPosts.length > 0 && (
            <div className="flex flex-col gap-2 rounded-xl border border-warning/30 bg-warning-light p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-warning" />
                <p className="text-sm font-semibold text-warning">
                  {data.zeroInboundPosts.length} post{data.zeroInboundPosts.length === 1 ? '' : 's'} with
                  no inbound internal links
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.zeroInboundPosts.map((post) => (
                  <a
                    key={post.slug}
                    href={adminHref(`/blog/posts/${post.id}/edit`)}
                    className="rounded-full border border-warning/40 bg-background px-3 py-1 text-xs text-foreground hover:underline"
                  >
                    {post.title}
                  </a>
                ))}
              </div>
            </div>
          )}

          <ElementTabs
            items={[
              { value: 'internal', label: 'Internal Links' },
              { value: 'external', label: 'External Links' },
            ]}
            defaultValue="internal"
          >
            <ElementTabs.Content value="internal">
              <PaginatedDimensionTable<InternalLinkRow>
                columns={internalColumns}
                rows={data.internalLinks}
                emptyContent={<p>No internal links found across your published posts.</p>}
                expandedRowContent={(row) => (
                  <PaginatedDimensionTable<InternalLinkSource>
                    columns={sourceColumns(adminHref)}
                    rows={row.original.sources}
                    emptyContent={<p>No sources.</p>}
                  />
                )}
              />
            </ElementTabs.Content>
            <ElementTabs.Content value="external">
              <PaginatedDimensionTable<ExternalLinkRow>
                columns={externalColumns}
                rows={data.externalLinks}
                emptyContent={<p>No external links found across your published posts.</p>}
                expandedRowContent={(row) => (
                  <div className="flex flex-col gap-2 p-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      Linked from:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {row.original.sourcePosts.map((post) => (
                        <a
                          key={post.slug}
                          href={adminHref(`/blog/posts/${post.id}/edit`)}
                          className="rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground hover:underline"
                        >
                          {post.title}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              />
            </ElementTabs.Content>
          </ElementTabs>

          <p className="text-xs text-muted-foreground">
            {data.totalPosts} published post{data.totalPosts === 1 ? '' : 's'} scanned.
          </p>
        </>
      )}
    </div>
  )
}
