export interface BlogSeries extends Record<string, unknown> {
  id: string
  name: string
  slug: string
  description: string | null
  isActive: boolean
  /** Posts currently assigned to this series. Read-only — set from the post form. */
  postCount: number
}

export interface BlogSeriesPayload {
  name: string
  slug: string
  description?: string
}
