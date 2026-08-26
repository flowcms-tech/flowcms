export interface BingUrlSubmissionQuota {
  dailyQuota: number
  monthlyQuota: number
}

export interface BingFetchedUrl extends Record<string, unknown> {
  url: string
  date: string | null
  fetched: boolean
  expired: boolean
}

export interface BingUrlSubmissionSummary {
  status: 'ok' | 'not_connected'
  reason: string | null
  urlQuota: BingUrlSubmissionQuota | null
  contentQuota: BingUrlSubmissionQuota | null
  fetchedUrls: BingFetchedUrl[]
}

export interface BingSubmitContentInput {
  url: string
  httpMessage: string
  structuredData: string
  dynamicServing: number
}
