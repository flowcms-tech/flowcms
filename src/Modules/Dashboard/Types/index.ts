import type { ActivityAction, ActivityEntityType } from '@/Framework/Activity/activityTypes'

/** What `/api/dashboard` returns. */
export interface DashboardSummary {
  counts: {
    published: number
    drafts: number
    scheduled: number
    pendingReview: number
    trashed: number
    questionsPending: number
  }
  /** Counts over *published* posts only — see the route. */
  health: {
    missingMetaDescription: number
    lowSeoScore: number
    stale: number
  }
  scheduled: { id: string; title: string; scheduledPublishAt: string | null }[]
  awaitingReview: { id: string; title: string; updatedAt: string; authorName: string | null }[]
  recentlyPublished: { id: string; title: string; publishedAt: string | null }[]
  recentActivity: {
    id: string
    actorName: string
    action: ActivityAction
    entityType: ActivityEntityType
    entityId: string | null
    entityLabel: string
    summary: string | null
    createdAt: string
  }[]
}
