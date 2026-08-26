'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, Info, Link2, RefreshCw, ShieldQuestion } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import { SeoAuditServices } from './Services/SeoAuditServices'
import { SEVERITY_ORDER, SeverityBadge, formatDateTime, scoreTone } from './Values/SeoAuditValues'
import type { AuditIssueGroup, AuditPostSummary, AuditSeverity } from './Types'

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-background p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold leading-none ${tone ?? ''}`}>{value}</p>
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  )
}

function IssueGroupCard({ group }: { group: AuditIssueGroup }) {
  const adminHref = useAdminHref()
  // Critical groups open by default; the rest stay collapsed so the screen
  // opens on what actually needs doing rather than on a wall of everything.
  const [isOpen, setIsOpen] = useState(group.severity === 'critical')

  return (
    <div className="rounded-xl border border-border bg-background">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-start gap-3 p-4 text-start"
        aria-expanded={isOpen}
      >
        <ChevronDown
          size={16}
          className={`mt-0.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? '' : '-rotate-90'}`}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{group.title}</span>
            <SeverityBadge severity={group.severity} />
            <ElementBadge variant="muted">{group.posts.length}</ElementBadge>
          </div>
          <p className="text-xs leading-snug text-muted-foreground">{group.description}</p>
        </div>
      </button>

      {isOpen && (
        <ul className="flex flex-col border-t border-border">
          {group.posts.map((entry, index) => (
            <li
              key={`${entry.postId}:${index}`}
              className="flex flex-col gap-0.5 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <Link
                href={adminHref(`/blog/posts/${entry.postId}/edit`)}
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {entry.title}
              </Link>
              <span className="text-xs leading-snug text-muted-foreground">{entry.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function SeoAuditModule() {
  const adminHref = useAdminHref()
  const queryClient = useQueryClient()
  const [isScanning, setIsScanning] = useState(false)
  const [severityFilter, setSeverityFilter] = useState<AuditSeverity | 'all'>('all')

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['blog-seo-audit'],
    queryFn: SeoAuditServices.report,
    // Matches the route's own cache window. Anything shorter just re-requests
    // the same cached body.
    staleTime: 60_000,
  })

  const groups = useMemo(() => {
    const all = data?.groups ?? []
    const ordered = [...all].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    )
    return severityFilter === 'all'
      ? ordered
      : ordered.filter((group) => group.severity === severityFilter)
  }, [data?.groups, severityFilter])

  async function handleScan() {
    setIsScanning(true)
    try {
      await SeoAuditServices.scanLinks()
      await queryClient.invalidateQueries({ queryKey: ['blog-seo-audit'] })
    } catch {
      // The service already surfaced it as a toast; a second one here would
      // just be noise.
    } finally {
      setIsScanning(false)
    }
  }

  const postColumns: ExtendedColumnDef<AuditPostSummary>[] = [
    {
      id: 'title',
      accessorKey: 'title',
      header: 'Post',
      cell: ({ row }) => (
        <Link
          href={adminHref(`/blog/posts/${row.original.postId}/edit`)}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {row.original.title}
        </Link>
      ),
    },
    {
      id: 'seoScore',
      header: 'SEO',
      alignRight: true,
      cell: ({ row }) => (
        <span className={`text-sm font-medium tabular-nums ${scoreTone(row.original.seoScore)}`}>
          {row.original.seoScore}
        </span>
      ),
    },
    {
      id: 'readabilityScore',
      header: 'Readability',
      alignRight: true,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{row.original.readabilityScore}</span>
      ),
    },
    {
      id: 'wordCount',
      header: 'Words',
      alignRight: true,
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.wordCount}</span>,
    },
    {
      id: 'issueCount',
      header: 'Issues',
      alignRight: true,
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.issueCount}</span>,
    },
    {
      id: 'status',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          {!row.original.isPublished && <ElementBadge variant="muted">Draft</ElementBadge>}
          {!row.original.isIndexable && <ElementBadge variant="warning">noindex</ElementBadge>}
        </div>
      ),
    },
  ]

  const tiles = data?.tiles

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">SEO audit</p>
          <p className="text-xs text-muted-foreground">
            Every non-trashed post, run through the same checks the editor panel uses.
            Computed fresh on each load and never stored — a saved audit is wrong the moment
            somebody saves a post.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ElementButton
            size="sm"
            variant="cancel"
            disabled={isFetching}
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['blog-seo-audit'] })}
          >
            <RefreshCw size={14} />
            Refresh
          </ElementButton>
          <ElementButton size="sm" onClick={() => void handleScan()} disabled={isScanning}>
            <Link2 size={14} />
            {isScanning ? 'Scanning…' : 'Scan links now'}
          </ElementButton>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Average SEO score"
          value={tiles ? String(tiles.averageSeoScore) : '—'}
          tone={tiles ? scoreTone(tiles.averageSeoScore) : undefined}
        />
        <Tile
          label="Posts below 50"
          value={tiles ? String(tiles.postsBelowFifty) : '—'}
          hint="Worth opening before writing anything new"
        />
        <Tile label="Total issues" value={tiles ? String(tiles.totalIssues) : '—'} />
        <Tile
          label="Clean edits, last 30 days"
          value={tiles ? String(tiles.recentlyFixed) : '—'}
          // Said plainly rather than dressed up as "issues resolved": there is
          // no stored history to diff against, by design, so this counts posts
          // edited recently that now have nothing wrong with them.
          hint="Posts edited recently that now have no issues"
        />
      </div>

      {data && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/20 p-4">
          <div className="flex items-center gap-2">
            <ShieldQuestion size={14} className="shrink-0 text-muted-foreground" />
            <p className="text-xs font-medium">Link scan</p>
          </div>
          <p className="text-xs leading-snug text-muted-foreground">
            {data.linkScan.lastScannedAt
              ? `Last run ${formatDateTime(data.linkScan.lastScannedAt)} — ${data.linkScan.broken} broken, ${data.linkScan.unverifiable} unverifiable.`
              : 'No scan has run yet. Broken links will not appear below until you run one.'}{' '}
            Plenty of sites answer automated requests with a 403 or a challenge page, so
            those are reported as <strong>unverifiable</strong> rather than broken — open one
            yourself before removing a citation. Only genuine 404s, 410s, and dead domains are
            called broken.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Show</span>
        {(['all', ...SEVERITY_ORDER] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setSeverityFilter(value)}
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
              severityFilter === value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-muted-foreground hover:text-foreground'
            }`}
          >
            {value === 'all' ? 'Everything' : value}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="rounded-xl border border-border bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
          Running the audit across every post…
        </div>
      )}

      {!isLoading && groups.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
          <Info size={20} className="text-muted-foreground" />
          <p className="text-sm font-medium">Nothing flagged</p>
          <p className="max-w-md text-xs text-muted-foreground">
            {severityFilter === 'all'
              ? 'No issues in any group. Worth re-running after the next batch of posts goes out.'
              : 'Nothing at this severity. Switch the filter to see the rest.'}
          </p>
        </div>
      )}

      {groups.length > 0 && (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <IssueGroupCard key={group.id} group={group} />
          ))}
        </div>
      )}

      <ElementTable<AuditPostSummary>
        columns={postColumns}
        data={data?.posts ?? []}
        loading={isLoading}
        loadingRows={5}
        headerContent={
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold">Every post, worst score first</p>
              <p className="text-xs text-muted-foreground">
                These scores come from the same analyser the editor panel runs, so a post opened
                from here shows the identical number.
              </p>
            </div>
          </div>
        }
        emptyContent={<p>No posts to audit yet.</p>}
      />
    </div>
  )
}
