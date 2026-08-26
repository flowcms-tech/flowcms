export type AuditSeverity = 'critical' | 'warning' | 'info'

export interface AuditIssuePost {
  postId: string
  title: string
  slug: string
  /** What is wrong with THIS post specifically. Group-level copy explains the
   *  rule; this line has to be enough to act on without opening the post. */
  detail: string
}

export interface AuditIssueGroup {
  id: string
  title: string
  /** Why it matters and what to do about it. */
  description: string
  severity: AuditSeverity
  posts: AuditIssuePost[]
}

export interface AuditPostSummary extends Record<string, unknown> {
  postId: string
  title: string
  slug: string
  /** Recomputed here by the same `analyseSeo` the editor panel runs — NOT read
   *  from the stored `seoScore` column, which is only as fresh as the last
   *  save. */
  seoScore: number
  readabilityScore: number
  wordCount: number
  isPublished: boolean
  isIndexable: boolean
  issueCount: number
}

export interface AuditTiles {
  averageSeoScore: number
  postsBelowFifty: number
  totalIssues: number
  /** A PROXY, not a measurement: posts edited in the last 30 days that now have
   *  no issues at all. The audit is deliberately never stored (a stored audit
   *  is stale the moment someone saves a post), so there is no history to
   *  diff against, and the UI labels this honestly rather than implying one
   *  exists. */
  recentlyFixed: number
}

export interface AuditLinkScanSummary {
  lastScannedAt: string | null
  broken: number
  /** Reported separately and never folded into `broken` — see the link checker
   *  for why calling a 403 "broken" makes the whole report ignorable. */
  unverifiable: number
}

export interface SeoAuditReport {
  generatedAt: string
  tiles: AuditTiles
  groups: AuditIssueGroup[]
  posts: AuditPostSummary[]
  linkScan: AuditLinkScanSummary
}

export interface LinkCheckRow extends Record<string, unknown> {
  id: string
  postId: string
  postTitle: string
  postSlug: string
  url: string
  isInternal: boolean
  statusCode: number | null
  result: 'ok' | 'broken' | 'redirect' | 'timeout' | 'unverifiable'
  checkedAt: string
}

export interface LinkCheckReport {
  results: LinkCheckRow[]
  lastScannedAt: string | null
  summary: Record<string, number>
}

export interface LinkScanOutcome {
  postsScanned: number
  linksChecked: number
  summary: Record<string, number>
  checkedAt: string
}
