/** Fixed presets rather than an arbitrary custom range — the same "last N
 *  days" choices most Search Console widgets (WordPress SEO plugins
 *  included) offer. Shared between the API route (validates the `days` query
 *  param against it) and the module (renders it as the filter row). */
export const WINDOW_DAY_OPTIONS = [7, 28, 90] as const
export type WindowDays = (typeof WINDOW_DAY_OPTIONS)[number]
export const DEFAULT_WINDOW_DAYS: WindowDays = 28

export type GscRangeSelection =
  | { kind: "preset"; days: WindowDays }
  | { kind: "custom"; startDate: string; endDate: string }

export interface GscTotals {
  clicks: number
  impressions: number
  /** 0–1, as Google reports it. */
  ctr: number
  /** 1-based, impression-weighted. */
  position: number
}

export interface GscDayPoint {
  /** YYYY-MM-DD. */
  date: string
  clicks: number
  impressions: number
}

export interface GscQueryRow extends Record<string, unknown> {
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface GscPageRow extends Record<string, unknown> {
  page: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

/** Raw ISO 3166-1 alpha-3 code, as GSC reports it (e.g. "usa", "can") — the
 *  module maps it to a display name; unrecognised codes fall back to the
 *  uppercased code itself rather than hiding the row. */
export interface GscCountryRow extends Record<string, unknown> {
  country: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

/** Raw "DESKTOP" / "MOBILE" / "TABLET", as GSC reports it. */
export interface GscDeviceRow extends Record<string, unknown> {
  device: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

/** Raw GSC label (e.g. "AMP_BLUE_LINK") — the module title-cases it. */
export interface GscSearchAppearanceRow extends Record<string, unknown> {
  searchAppearance: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface GscDateRow extends Record<string, unknown> {
  /** YYYY-MM-DD. */
  date: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

/** Same reasoning as the per-post Insights panel: "not connected" and
 *  "genuinely zero impressions" need different messages, so the route
 *  reports which one it is rather than collapsing both into an empty array. */
export type GscDashboardStatus = "ok" | "not_connected" | "no_data"

export interface GscSiteDashboard {
  status: GscDashboardStatus
  /** Populated for `not_connected` — says which half of the setup is missing. */
  reason: string | null
  siteUrl: string
  /** Inclusive YYYY-MM-DD bounds, ending at the freshest date Google is likely
   *  to have finalised rather than at today. */
  startDate: string
  endDate: string
  /** How many days behind today `endDate` sits. */
  lagDays: number
  totals: GscTotals
  /** Every day in range, gaps zero-filled — feeds the trend charts only. */
  series: GscDayPoint[]
  topQueries: GscQueryRow[]
  topPages: GscPageRow[]
  topCountries: GscCountryRow[]
  topDevices: GscDeviceRow[]
  topSearchAppearances: GscSearchAppearanceRow[]
  /** Days Google actually returned rows for (no zero-fill) — feeds the Days
   *  tab table, most recent first. */
  byDate: GscDateRow[]
}

// -- Page indexing -------------------------------------------------------------

export interface GscUrlInspectionRow extends Record<string, unknown> {
  url: string
  /** Derived from `verdict === "PASS"` — the one boolean the rest of the
   *  page treats as ground truth for "indexed or not". */
  indexed: boolean
  verdict: string | null
  coverageState: string | null
  robotsTxtState: string | null
  indexingState: string | null
  pageFetchState: string | null
  lastCrawlTime: string | null
  googleCanonical: string | null
  userCanonical: string | null
  /** True when Google picked a different canonical than the page declared —
   *  the single most common cause of "why isn't MY url the one indexed". */
  canonicalMismatch: boolean
  mobileUsabilityVerdict: string | null
  mobileUsabilityIssueCount: number
  richResultsVerdict: string | null
  richResultsTypeCount: number
  /** One entry per detected rich-result type on this page — feeds the
   *  Enhancements screen's per-type aggregation. */
  richResultTypes: { type: string; validCount: number; invalidCount: number }[]
  inspectionResultLink: string | null
  /** Set only when this one URL's inspection call itself failed (e.g. rate
   *  limit) — the row still renders, with every other field null, rather
   *  than one bad URL blanking the whole report. */
  error: string | null
}

// -- Enhancements (Rich Results) ------------------------------------------------

export interface GscEnhancementPage extends Record<string, unknown> {
  url: string
  valid: boolean
}

export interface GscEnhancementRow extends Record<string, unknown> {
  type: string
  validPages: number
  invalidPages: number
  pages: GscEnhancementPage[]
}

export type GscEnhancementsStatus = "ok" | "not_connected" | "no_pages"

export interface GscEnhancementsSummary {
  status: GscEnhancementsStatus
  reason: string | null
  siteUrl: string
  checkedAt: string | null
  enhancements: GscEnhancementRow[]
  totalKnownPages: number
  inspectedCount: number
}

/** "Website" issues are fixable by changing the page/site; "Google systems"
 *  issues are Google's own crawl/index decisions (e.g. "seen it, chose not
 *  to index it yet") — same split the real Search Console UI draws, because
 *  it changes what action is actually available. */
export type GscIndexingReasonSource = "Website" | "Google systems"

export interface GscIndexingReasonRow extends Record<string, unknown> {
  reason: string
  source: GscIndexingReasonSource
  pages: number
  urls: string[]
}

export type GscPageIndexingStatus = "ok" | "not_connected" | "no_pages"

// -- Sitemaps ------------------------------------------------------------------

export interface GscSitemapRow extends Record<string, unknown> {
  path: string
  type: string | null
  isSitemapsIndex: boolean
  isPending: boolean
  lastSubmitted: string | null
  lastDownloaded: string | null
  errorCount: number
  warningCount: number
  urlCount: number
}

export interface GscSitemapsSummary {
  status: "ok" | "not_connected"
  reason: string | null
  siteUrl: string
  sitemaps: GscSitemapRow[]
}

// -- Internal / external links (computed locally, not from Google) ------------

export interface InternalLinkSource extends Record<string, unknown> {
  id: string
  slug: string
  title: string
}

export interface InternalLinkRow extends Record<string, unknown> {
  targetId: string
  targetSlug: string
  targetTitle: string
  inboundCount: number
  sources: InternalLinkSource[]
}

export interface ExternalLinkRow extends Record<string, unknown> {
  domain: string
  count: number
  urls: string[]
  sourcePosts: InternalLinkSource[]
}

export interface LinksReport {
  status: "ok" | "no_pages"
  checkedAt: string | null
  internalLinks: InternalLinkRow[]
  externalLinks: ExternalLinkRow[]
  /** Published posts with zero inbound internal links — surfaced separately
   *  from the sorted table so the "nobody links to this" list doesn't
   *  require scrolling to the bottom to find. */
  zeroInboundPosts: InternalLinkSource[]
  totalPosts: number
}

// -- Core Web Vitals (PageSpeed Insights) ---------------------------------------

export type CwvStrategy = "mobile" | "desktop"

export interface CwvMetricValue {
  percentile: number | null
  category: "FAST" | "AVERAGE" | "SLOW" | null
}

export interface CwvPageRow extends Record<string, unknown> {
  url: string
  overallCategory: string | null
  performanceScore: number | null
  lcp: CwvMetricValue
  cls: CwvMetricValue
  inp: CwvMetricValue
  fcp: CwvMetricValue
  labLcpMs: number | null
  labCls: number | null
  labTbtMs: number | null
  error: string | null
}

export type CwvStatus = "ok" | "not_configured" | "no_pages"

export interface CwvSummary {
  status: CwvStatus
  reason: string | null
  strategy: CwvStrategy
  checkedAt: string | null
  goodCount: number
  needsImprovementCount: number
  poorCount: number
  erroredCount: number
  pages: CwvPageRow[]
  totalKnownPages: number
  inspectedCount: number
}

// -- Manual Actions & Security Issues (manual tracking log) --------------------

export interface SearchConsoleIssue extends Record<string, unknown> {
  id: string
  type: 'manual_action' | 'security_issue'
  title: string
  description: string | null
  /** Nullable — most issues are site-wide; populated ones join into the
   *  Page Profile view for that URL. */
  url: string | null
  detectedAt: string | null
  status: 'open' | 'resolved'
  resolvedAt: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

// -- Action Feed (aggregated across all seven sources above) ------------------

export type ActionFeedSeverity = "critical" | "warning" | "opportunity"
export type ActionFeedSource =
  | "issues_log" | "page_indexing" | "sitemaps"
  | "enhancements" | "core_web_vitals" | "links" | "report"
export type ActionFeedAudience = "developer" | "seo_manager" | "marketer" | "content_creator"

export interface ActionFeedItem extends Record<string, unknown> {
  /** Stable hash of source+type+identifier — the React key and de-dupe key,
   *  not persisted anywhere. */
  id: string
  source: ActionFeedSource
  severity: ActionFeedSeverity
  title: string
  description: string
  affectedCount: number
  /** Up to 5 example URLs — enough to link out, not a full dump. */
  urls: string[]
  /** Deep link to the existing screen that explains this item fully. */
  href: string
  audience: ActionFeedAudience[]
  /** Post IDs this item is attributable to, when known — lets the Content
   *  Creator role filter to "issues on pages I wrote". */
  postIds: string[]
}

export interface ActionFeedSummary {
  status: "ok" | "not_connected"
  reason: string | null
  checkedAt: string
  items: ActionFeedItem[]
  healthScore: number
  /** Post ids authored by the requesting session's user — resolved
   *  server-side so the Content Creator role filter never needs a second
   *  round trip or to see other authors' post ids. */
  viewerAuthoredPostIds: string[]
}

export type ActionFeedRole = "all" | "developer" | "seo_manager" | "marketer" | "content_creator" | "executive"

// -- Page Profile (single-URL join across every source above) -----------------

export interface PageProfile {
  /** Null when looked up by an ad-hoc URL that isn't a known post. */
  postId: string | null
  url: string
  title: string | null
  performance: { totals: GscTotals; series: GscDayPoint[] } | null
  inspection: GscUrlInspectionRow | null
  coreWebVitals: { mobile: CwvPageRow | null; desktop: CwvPageRow | null }
  internalInbound: InternalLinkRow | null
  externalOutbound: string[]
  relatedIssues: SearchConsoleIssue[]
}

export interface GscPageIndexingSummary {
  status: GscPageIndexingStatus
  reason: string | null
  siteUrl: string
  /** ISO timestamp of when this batch was computed — since there is no
   *  historical trend available (see module doc), this is a snapshot time,
   *  not a date range. */
  checkedAt: string | null
  indexedCount: number
  /** Confirmed not indexed — excludes `erroredCount`. A page whose inspection
   *  call itself failed hasn't been told "not indexed" by Google, so it must
   *  not be counted (or explained) as one. */
  notIndexedCount: number
  /** Inspection calls that failed outright (quota, rate limit, URL not part
   *  of this property) — counted separately so "622 not indexed" never
   *  silently includes "we couldn't even check these". */
  erroredCount: number
  reasons: GscIndexingReasonRow[]
  pages: GscUrlInspectionRow[]
  /** How many of the site's known published posts exist in total, vs how
   *  many were actually inspected this run (capped — see route) — surfaced
   *  so a partial run reads as "more exist" rather than "that's everything". */
  totalKnownPages: number
  inspectedCount: number
}
