export interface BingFeed extends Record<string, unknown> {
  url: string
  type: string
  status: string
  urlCount: number
  fileSize: number
  compressed: boolean
  lastCrawled: string | null
  submitted: string | null
}

export interface BingSitemapsSummary {
  status: "ok" | "not_connected"
  reason: string | null
  siteUrl: string
  feeds: BingFeed[]
}
