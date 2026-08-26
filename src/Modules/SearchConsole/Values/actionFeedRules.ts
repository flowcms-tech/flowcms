import type {
  ActionFeedItem,
  CwvSummary,
  GscEnhancementsSummary,
  GscPageIndexingSummary,
  GscSiteDashboard,
  GscSitemapsSummary,
  LinksReport,
  SearchConsoleIssue,
} from "../Types"

/**
 * One pure rule function per Search Console data source, each turning that
 * source's already-computed summary into zero or more `ActionFeedItem`s.
 * Severities follow the design doc's per-source table — see
 * dev-docs/superpowers/specs/2026-08-06-search-console-action-feed-and-profile-design.md.
 *
 * Every function tolerates a non-"ok" summary status by returning an empty
 * array rather than throwing — one disconnected/unconfigured source must
 * never blank the whole feed.
 */

const MAX_EXAMPLE_URLS = 5

function exampleUrls(urls: string[]): string[] {
  return urls.slice(0, MAX_EXAMPLE_URLS)
}

function postIdsForUrls(urls: string[], postIdByUrl: Map<string, string>): string[] {
  const ids = new Set<string>()
  for (const url of urls) {
    const id = postIdByUrl.get(url)
    if (id) ids.add(id)
  }
  return Array.from(ids)
}

export function issuesLogItems(issues: SearchConsoleIssue[], postIdByUrl: Map<string, string>): ActionFeedItem[] {
  return issues.map((issue) => ({
    id: `issues_log:${issue.id}`,
    source: "issues_log",
    severity: "critical",
    title: issue.title,
    description: issue.description ?? `Logged ${issue.type === "manual_action" ? "manual action" : "security issue"}, still open.`,
    affectedCount: 1,
    urls: issue.url ? [issue.url] : [],
    href: "/search-console/issues-log",
    audience: ["developer", "seo_manager"],
    postIds: issue.url ? postIdsForUrls([issue.url], postIdByUrl) : [],
  }))
}

/** Same Website/Google-systems split the page-indexing route itself draws —
 *  it's the difference between "you can fix this" and "Google decided this
 *  on its own crawl budget", which is exactly what determines severity here. */
export function pageIndexingItems(summary: GscPageIndexingSummary, postIdByUrl: Map<string, string>): ActionFeedItem[] {
  if (summary.status !== "ok") return []

  const items: ActionFeedItem[] = summary.reasons.map((group) => ({
    id: `page_indexing:${group.reason}`,
    source: "page_indexing",
    severity: group.source === "Website" ? "critical" : "warning",
    title: `${group.pages} page${group.pages === 1 ? "" : "s"}: ${group.reason}`,
    description:
      group.source === "Website"
        ? "A site-side problem is keeping these pages out of the index — fixable."
        : "Google crawled these but hasn't indexed them yet, on its own schedule.",
    affectedCount: group.pages,
    urls: exampleUrls(group.urls),
    href: "/search-console/page-indexing",
    audience: ["developer", "seo_manager"],
    postIds: postIdsForUrls(group.urls, postIdByUrl),
  }))

  if (summary.erroredCount > 0) {
    items.push({
      id: "page_indexing:errored",
      source: "page_indexing",
      severity: "warning",
      title: `${summary.erroredCount} page${summary.erroredCount === 1 ? "" : "s"} couldn't be inspected`,
      description: "The URL Inspection call itself failed for these pages — status unknown, not confirmed unindexed.",
      affectedCount: summary.erroredCount,
      urls: [],
      href: "/search-console/page-indexing",
      audience: ["developer"],
      postIds: [],
    })
  }

  return items
}

export function sitemapsItems(summary: GscSitemapsSummary): ActionFeedItem[] {
  if (summary.status !== "ok") return []

  const items: ActionFeedItem[] = []
  const withErrors = summary.sitemaps.filter((s) => s.errorCount > 0)
  const withWarnings = summary.sitemaps.filter((s) => s.warningCount > 0)

  if (withErrors.length > 0) {
    items.push({
      id: "sitemaps:errors",
      source: "sitemaps",
      severity: "critical",
      title: `${withErrors.length} sitemap${withErrors.length === 1 ? "" : "s"} reporting errors`,
      description: "Google flagged errors while processing these sitemaps.",
      affectedCount: withErrors.length,
      urls: exampleUrls(withErrors.map((s) => s.path)),
      href: "/search-console/sitemaps",
      audience: ["developer", "seo_manager"],
      postIds: [],
    })
  }

  if (withWarnings.length > 0) {
    items.push({
      id: "sitemaps:warnings",
      source: "sitemaps",
      severity: "warning",
      title: `${withWarnings.length} sitemap${withWarnings.length === 1 ? "" : "s"} reporting warnings`,
      description: "Google flagged warnings while processing these sitemaps.",
      affectedCount: withWarnings.length,
      urls: exampleUrls(withWarnings.map((s) => s.path)),
      href: "/search-console/sitemaps",
      audience: ["developer", "seo_manager"],
      postIds: [],
    })
  } else if (summary.sitemaps.length === 0) {
    items.push({
      id: "sitemaps:none",
      source: "sitemaps",
      severity: "warning",
      title: "No sitemaps submitted",
      description: "Google has no submitted sitemap for this property.",
      affectedCount: 0,
      urls: [],
      href: "/search-console/sitemaps",
      audience: ["developer", "seo_manager"],
      postIds: [],
    })
  }

  return items
}

export function enhancementsItems(summary: GscEnhancementsSummary, postIdByUrl: Map<string, string>): ActionFeedItem[] {
  if (summary.status !== "ok") return []

  return summary.enhancements
    .filter((row) => row.invalidPages > 0)
    .map((row) => {
      const invalidUrls = row.pages.filter((p) => !p.valid).map((p) => p.url)
      return {
        id: `enhancements:${row.type}`,
        source: "enhancements",
        severity: "warning",
        title: `${row.invalidPages} page${row.invalidPages === 1 ? "" : "s"} with invalid ${row.type} markup`,
        description: `Rich result type "${row.type}" has validation issues on these pages.`,
        affectedCount: row.invalidPages,
        urls: exampleUrls(invalidUrls),
        href: "/search-console/enhancements",
        audience: ["developer", "seo_manager"],
        postIds: postIdsForUrls(invalidUrls, postIdByUrl),
      }
    })
}

export function coreWebVitalsItems(summary: CwvSummary, postIdByUrl: Map<string, string>): ActionFeedItem[] {
  if (summary.status !== "ok") return []

  const items: ActionFeedItem[] = []
  const poorPages = summary.pages.filter((p) => p.overallCategory === "SLOW")
  const needsImprovementPages = summary.pages.filter((p) => p.overallCategory === "AVERAGE")

  if (poorPages.length > 0) {
    const urls = poorPages.map((p) => p.url)
    items.push({
      id: `core_web_vitals:poor:${summary.strategy}`,
      source: "core_web_vitals",
      severity: "critical",
      title: `${poorPages.length} page${poorPages.length === 1 ? "" : "s"} with poor Core Web Vitals (${summary.strategy})`,
      description: "Field data puts these pages in the 'poor' band — real users are having a slow experience.",
      affectedCount: poorPages.length,
      urls: exampleUrls(urls),
      href: "/search-console/core-web-vitals",
      audience: ["developer"],
      postIds: postIdsForUrls(urls, postIdByUrl),
    })
  }

  if (needsImprovementPages.length > 0) {
    const urls = needsImprovementPages.map((p) => p.url)
    items.push({
      id: `core_web_vitals:needs_improvement:${summary.strategy}`,
      source: "core_web_vitals",
      severity: "warning",
      title: `${needsImprovementPages.length} page${needsImprovementPages.length === 1 ? "" : "s"} needing Core Web Vitals improvement (${summary.strategy})`,
      description: "Field data puts these pages in the 'needs improvement' band.",
      affectedCount: needsImprovementPages.length,
      urls: exampleUrls(urls),
      href: "/search-console/core-web-vitals",
      audience: ["developer"],
      postIds: postIdsForUrls(urls, postIdByUrl),
    })
  }

  return items
}

export function linksItems(report: LinksReport): ActionFeedItem[] {
  if (report.status !== "ok" || report.zeroInboundPosts.length === 0) return []

  return [
    {
      id: "links:orphaned",
      source: "links",
      severity: "warning",
      title: `${report.zeroInboundPosts.length} published post${report.zeroInboundPosts.length === 1 ? "" : "s"} with no internal inbound links`,
      description: "Nothing on the site links to these posts — they're only reachable by direct URL or search.",
      affectedCount: report.zeroInboundPosts.length,
      urls: [],
      href: "/search-console/links",
      audience: ["seo_manager", "content_creator"],
      postIds: report.zeroInboundPosts.slice(0, MAX_EXAMPLE_URLS).map((p) => p.id),
    },
  ]
}

/** Fixed lookup table, not a formula — real position-vs-CTR curves are
 *  noisy; a coarse floor is honest about being a heuristic. Beyond position
 *  20 no opportunity is flagged: ranking is the real problem there, not CTR. */
const CTR_FLOOR_BY_POSITION = [
  { maxPosition: 3, floor: 0.15 },
  { maxPosition: 10, floor: 0.05 },
  { maxPosition: 20, floor: 0.02 },
]

function ctrFloorFor(position: number): number | null {
  const bucket = CTR_FLOOR_BY_POSITION.find((b) => position <= b.maxPosition)
  return bucket ? bucket.floor : null
}

const MIN_IMPRESSIONS_FOR_OPPORTUNITY = 50

export function reportOpportunityItems(dashboard: GscSiteDashboard, postIdByUrl: Map<string, string>): ActionFeedItem[] {
  if (dashboard.status !== "ok") return []

  const underperforming = dashboard.topPages.filter((row) => {
    if (row.impressions < MIN_IMPRESSIONS_FOR_OPPORTUNITY) return false
    const floor = ctrFloorFor(row.position)
    return floor !== null && row.ctr < floor
  })

  if (underperforming.length === 0) return []

  const urls = underperforming.map((row) => row.page)
  return [
    {
      id: "report:low_ctr_pages",
      source: "report",
      severity: "opportunity",
      title: `${underperforming.length} page${underperforming.length === 1 ? "" : "s"} ranking well but under-clicked`,
      description: "These pages get meaningful impressions at a strong position but a below-expected click-through rate — a title/description rewrite is likely the fastest win available.",
      affectedCount: underperforming.length,
      urls: exampleUrls(urls),
      href: "/search-console/report",
      audience: ["marketer", "seo_manager"],
      postIds: postIdsForUrls(urls, postIdByUrl),
    },
  ]
}

export function healthScore(items: ActionFeedItem[]): number {
  const critical = items.filter((i) => i.severity === "critical").length
  const warning = items.filter((i) => i.severity === "warning").length
  return Math.max(0, 100 - critical * 10 - warning * 3)
}
