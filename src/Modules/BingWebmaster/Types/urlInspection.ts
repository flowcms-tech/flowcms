export interface BingUrlProfile extends Record<string, unknown> {
  url: string
  isPage: boolean
  anchorCount: number | null
  documentSize: number | null
  httpStatus: number | null
  totalChildUrlCount: number | null
  discoveryDate: string | null
  lastCrawledDate: string | null
  clicks: number | null
  impressions: number | null
}

export interface BingUrlInspectionResult {
  status: "ok" | "not_connected" | "empty"
  reason: string | null
  siteUrl: string
  lookupUrl: string
  kind: "page" | "directory" | null
  /** Populated when `kind === "page"`. */
  page: BingUrlProfile | null
  /** Populated when `kind === "directory"`. */
  children: BingUrlProfile[]
}
