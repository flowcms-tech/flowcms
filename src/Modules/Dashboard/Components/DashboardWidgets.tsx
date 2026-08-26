'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import Link from 'next/link'
import { format, formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import {
  ACTIVITY_ACTION_LABELS,
  ACTIVITY_ENTITY_LABELS,
  activityEntityHref,
} from '@/Framework/Activity/activityTypes'
import type { DashboardSummary } from '../Types'

/**
 * The dashboard's building blocks.
 *
 * Every widget is a link to the screen that can act on what it shows. A number
 * with nowhere to go is a number people learn to stop reading — so a stat tile
 * with a count of zero renders muted and un-clickable rather than sending
 * someone to an empty list.
 */

export function StatTile({
  label,
  value,
  href,
  tone = 'default',
  loading,
}: {
  label: string
  value: number
  href: string
  tone?: 'default' | 'attention'
  loading?: boolean
}) {
  const content = (
    <>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {loading ? (
        <span className="mt-1 block h-7 w-10 animate-pulse rounded bg-muted" />
      ) : (
        <span
          className={cn(
            'mt-1 block text-2xl font-semibold tabular-nums',
            tone === 'attention' && value > 0 && 'text-amber-600 dark:text-amber-400'
          )}
        >
          {value}
        </span>
      )}
    </>
  )

  const className =
    'rounded-xl border border-border bg-background p-4 shadow-sm transition-colors'

  if (loading || value === 0) {
    return <div className={cn(className, 'opacity-70')}>{content}</div>
  }

  return (
    <Link href={href} className={cn(className, 'block hover:border-primary/50 hover:bg-muted/40')}>
      {content}
    </Link>
  )
}

export function WidgetCard({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: { label: string; href: string }
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col rounded-xl border border-border bg-background shadow-sm">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {action && (
          <Link href={action.href} className="shrink-0 text-xs font-medium text-primary hover:underline">
            {action.label}
          </Link>
        )}
      </header>
      <div className="flex-1 px-4 py-3">{children}</div>
    </section>
  )
}

export function WidgetEmpty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-xs text-muted-foreground">{children}</p>
}

export function WidgetSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 py-1">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-8 animate-pulse rounded bg-muted" />
      ))}
    </div>
  )
}

function PostRow({
  id,
  title,
  meta,
}: {
  id: string
  title: string
  meta: string
}) {
  const adminHref = useAdminHref()
  return (
    <li className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-0">
      <Link
        href={adminHref(`/blog/posts/${id}/edit`)}
        className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
      >
        {title}
      </Link>
      <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
    </li>
  )
}

export function ScheduledWidget({ items }: { items: DashboardSummary['scheduled'] }) {
  if (items.length === 0) return <WidgetEmpty>Nothing is scheduled.</WidgetEmpty>
  return (
    <ul>
      {items.map((post) => (
        <PostRow
          key={post.id}
          id={post.id}
          title={post.title}
          // Absolute date and time, not "in 3 days": the whole question about a
          // scheduled post is exactly when it goes live.
          meta={
            post.scheduledPublishAt
              ? format(new Date(post.scheduledPublishAt), 'MMM d, HH:mm')
              : '—'
          }
        />
      ))}
    </ul>
  )
}

export function AwaitingReviewWidget({ items }: { items: DashboardSummary['awaitingReview'] }) {
  if (items.length === 0) return <WidgetEmpty>The review queue is clear.</WidgetEmpty>
  return (
    <ul>
      {items.map((post) => (
        <PostRow
          key={post.id}
          id={post.id}
          title={post.title}
          // How long it has been waiting, because that is what makes a queue
          // item urgent — not who submitted it.
          meta={`${post.authorName || 'Unknown'} · ${formatDistanceToNow(new Date(post.updatedAt), { addSuffix: true })}`}
        />
      ))}
    </ul>
  )
}

export function RecentlyPublishedWidget({
  items,
}: {
  items: DashboardSummary['recentlyPublished']
}) {
  if (items.length === 0) return <WidgetEmpty>Nothing has been published yet.</WidgetEmpty>
  return (
    <ul>
      {items.map((post) => (
        <PostRow
          key={post.id}
          id={post.id}
          title={post.title}
          meta={post.publishedAt ? format(new Date(post.publishedAt), 'MMM d, yyyy') : '—'}
        />
      ))}
    </ul>
  )
}

export function RecentActivityWidget({ items }: { items: DashboardSummary['recentActivity'] }) {
  // Before the early return: a hook after it would run conditionally.
  const adminHref = useAdminHref()
  if (items.length === 0) return <WidgetEmpty>No changes recorded yet.</WidgetEmpty>
  return (
    <ul className="flex flex-col">
      {items.map((entry) => {
        const relativeHref = activityEntityHref(entry.entityType, entry.entityId)
        const href = relativeHref ? adminHref(relativeHref) : null
        return (
          <li
            key={entry.id}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border/60 py-2 text-sm last:border-0"
          >
            <span className="font-medium">{entry.actorName}</span>
            <span className="text-muted-foreground">
              {ACTIVITY_ACTION_LABELS[entry.action].toLowerCase()}
            </span>
            <ElementBadge variant="muted">
              {ACTIVITY_ENTITY_LABELS[entry.entityType]}
            </ElementBadge>
            {href ? (
              <Link href={href} className="min-w-0 max-w-[16rem] truncate hover:underline">
                {entry.entityLabel}
              </Link>
            ) : (
              <span className="min-w-0 max-w-[16rem] truncate">{entry.entityLabel}</span>
            )}
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export function HealthWidget({ health }: { health: DashboardSummary['health'] }) {
  const adminHref = useAdminHref()
  const rows: { label: string; value: number; href: string }[] = [
    {
      label: 'Published posts with no meta description',
      value: health.missingMetaDescription,
      href: adminHref('/blog/seo-audit'),
    },
    {
      label: 'Published posts scoring under 60',
      value: health.lowSeoScore,
      href: adminHref('/blog/seo-audit'),
    },
    {
      label: 'Published posts not updated in a year',
      value: health.stale,
      href: adminHref('/blog/seo-audit'),
    },
  ]

  return (
    <ul>
      {rows.map((row) => (
        <li
          key={row.label}
          className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-0"
        >
          <span className="text-sm text-muted-foreground">{row.label}</span>
          {row.value > 0 ? (
            <Link
              href={row.href}
              className="shrink-0 text-sm font-semibold tabular-nums text-amber-600 hover:underline dark:text-amber-400"
            >
              {row.value}
            </Link>
          ) : (
            <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">0</span>
          )}
        </li>
      ))}
    </ul>
  )
}
