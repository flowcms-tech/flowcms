import type { ActivityAction, ActivityEntityType } from '@/Framework/Activity/activityTypes'

/** One row as `/api/activity-log` serializes it. */
export interface ActivityEntry extends Record<string, unknown> {
  id: string
  /** Null once the account was deleted — `actorName` is the snapshot that keeps
   *  the row readable, and the filter dropdown omits these. */
  actorId: string | null
  actorName: string
  action: ActivityAction
  entityType: ActivityEntityType
  entityId: string | null
  entityLabel: string
  summary: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

export interface ActivityListResponse {
  current_page: number
  per_page: number
  total: number
  data: ActivityEntry[]
  actors: { id: string; name: string }[]
}

export interface ActivityListParams {
  action?: string
  entityType?: string
  entityId?: string
  actorId?: string
  search?: string
  page?: number
}
