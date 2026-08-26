export interface BingCrawlStats extends Record<string, unknown> {
  date: string | null
  allOtherCodes: number
  blockedByRobotsTxt: number
  code2xx: number
  code301: number
  code302: number
  code4xx: number
  code5xx: number
  containsMalware: number
  crawlErrors: number
  crawledPages: number
  inIndex: number
  inLinks: number
}

export interface BingCrawlIssue extends Record<string, unknown> {
  url: string
  httpCode: number
  inLinks: number
  issuesCode: number
}

export interface BingCrawlSettings {
  crawlRate: number[]
  ajaxEnabled: boolean | null
  crawlBoostAvailable: boolean | null
  crawlBoostEnabled: boolean | null
}

export interface BingCrawlSummary {
  status: "ok" | "not_connected"
  reason: string | null
  stats: BingCrawlStats[]
  issues: BingCrawlIssue[]
  settings: BingCrawlSettings | null
}

export interface UpdateCrawlSettingsPayload {
  crawlRate: number[]
}
