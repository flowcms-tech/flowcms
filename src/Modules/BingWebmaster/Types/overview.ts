export interface BingOverviewSite {
  url: string
  isVerified: boolean
  authenticationCode: string | null
}

export interface BingOverviewQuota {
  dailyQuota: number
  monthlyQuota: number
}

export interface BingOverview {
  status: "ok" | "not_connected"
  reason: string | null
  siteUrl: string
  siteVerified: boolean
  sites: BingOverviewSite[]
  urlSubmissionQuota: BingOverviewQuota | null
  contentSubmissionQuota: BingOverviewQuota | null
}
