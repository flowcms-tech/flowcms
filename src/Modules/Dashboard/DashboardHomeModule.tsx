'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import { DashboardServices } from './Services/DashboardServices'
import {
  AwaitingReviewWidget,
  HealthWidget,
  RecentActivityWidget,
  RecentlyPublishedWidget,
  ScheduledWidget,
  StatTile,
  WidgetCard,
  WidgetSkeleton,
} from './Components/DashboardWidgets'

interface DashboardHomeModuleProps {
  /** Resolved server-side by the page — the greeting is the one thing that
   *  should not wait for a fetch. */
  userName: string
}

/**
 * The panel's landing screen.
 *
 * Ordered by what someone signing in needs to decide: what is waiting on them
 * (review queue, scheduled), then what just happened (activity), then what is
 * quietly wrong (health). Counts sit on top as a single row because they are
 * scanned, not read.
 */
export default function DashboardHomeModule({ userName }: DashboardHomeModuleProps) {
  const adminHref = useAdminHref()
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => DashboardServices.summary(),
  })

  const counts = data?.counts

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Welcome back, {userName}.</p>
        </div>
        <Link href={adminHref("/blog/posts/create")}>
          <ElementButton size="sm">
            <Plus size={15} />
            New Post
          </ElementButton>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Published"
          value={counts?.published ?? 0}
          href={adminHref("/blog/posts")}
          loading={isLoading}
        />
        <StatTile
          label="Drafts"
          value={counts?.drafts ?? 0}
          href={adminHref("/blog/posts")}
          loading={isLoading}
        />
        <StatTile
          label="Scheduled"
          value={counts?.scheduled ?? 0}
          href={adminHref("/blog/posts")}
          loading={isLoading}
        />
        <StatTile
          label="Awaiting review"
          value={counts?.pendingReview ?? 0}
          href={adminHref("/blog/pending-review")}
          tone="attention"
          loading={isLoading}
        />
        <StatTile
          label="Questions to moderate"
          value={counts?.questionsPending ?? 0}
          href={adminHref("/blog/questions")}
          tone="attention"
          loading={isLoading}
        />
        <StatTile
          label="In trash"
          value={counts?.trashed ?? 0}
          href={adminHref("/blog/posts?trashed=true")}
          loading={isLoading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <WidgetCard
          title="Waiting on you"
          description="Submissions in the review queue, oldest first."
          action={{ label: 'Review queue', href: adminHref('/blog/pending-review') }}
        >
          {isLoading ? <WidgetSkeleton /> : <AwaitingReviewWidget items={data?.awaitingReview ?? []} />}
        </WidgetCard>

        <WidgetCard
          title="Going live soon"
          description="Scheduled posts, next first."
          action={{ label: 'All posts', href: adminHref('/blog/posts') }}
        >
          {isLoading ? <WidgetSkeleton /> : <ScheduledWidget items={data?.scheduled ?? []} />}
        </WidgetCard>

        <WidgetCard
          title="Recent activity"
          description="Every change made in the panel."
          action={{ label: 'Full log', href: adminHref('/activity-log') }}
        >
          {isLoading ? (
            <WidgetSkeleton rows={5} />
          ) : (
            <RecentActivityWidget items={data?.recentActivity ?? []} />
          )}
        </WidgetCard>

        <WidgetCard
          title="Needs attention"
          description="Live pages worth a second look."
          action={{ label: 'SEO audit', href: adminHref('/blog/seo-audit') }}
        >
          {isLoading ? (
            <WidgetSkeleton />
          ) : (
            <HealthWidget
              health={data?.health ?? { missingMetaDescription: 0, lowSeoScore: 0, stale: 0 }}
            />
          )}
        </WidgetCard>

        <WidgetCard
          title="Recently published"
          action={{ label: 'All posts', href: adminHref('/blog/posts') }}
        >
          {isLoading ? (
            <WidgetSkeleton />
          ) : (
            <RecentlyPublishedWidget items={data?.recentlyPublished ?? []} />
          )}
        </WidgetCard>
      </div>
    </div>
  )
}
