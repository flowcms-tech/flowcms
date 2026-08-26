export interface BingRankAndTrafficStat {
  date: string | null
  clicks: number
  impressions: number
}

export interface BingQueryStat extends Record<string, unknown> {
  query: string
  date: string | null
  clicks: number
  impressions: number
  avgClickPosition: number
  avgImpressionPosition: number
}

export interface BingPageStat extends Record<string, unknown> {
  pageUrl: string
  date: string | null
  clicks: number
  impressions: number
  avgClickPosition: number
  avgImpressionPosition: number
}

export interface BingDetailedQueryStat {
  date: string | null
  clicks: number
  impressions: number
  position: number
}

export interface BingTrafficSummary {
  status: "ok" | "not_connected"
  reason: string | null
  siteUrl: string
  series: BingRankAndTrafficStat[]
  topQueries: BingQueryStat[]
  topPages: BingPageStat[]
}
