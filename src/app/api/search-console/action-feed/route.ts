import { adminPath } from "@/Framework/Config/adminPath"
import { NextRequest, NextResponse } from "next/server"
import { getPageIndexingSummary } from "@/app/api/integrations/google-search-console/page-indexing/route"
import { getSitemapsSummary } from "@/app/api/integrations/google-search-console/sitemaps/route"
import { getEnhancementsSummary } from "@/app/api/integrations/google-search-console/enhancements/route"
import { getCoreWebVitalsSummary } from "@/app/api/integrations/pagespeed/core-web-vitals/route"
import { getLinksReport } from "@/app/api/links-report/route"
import { getOpenIssues } from "@/app/api/search-console-issues/route"
import { getSitePerformanceSummary } from "@/app/api/integrations/google-search-console/site-performance/route"
import { getKnownPublishedPostsMeta } from "@/Framework/Integrations/knownPageInspections"
import {
  issuesLogItems,
  pageIndexingItems,
  sitemapsItems,
  enhancementsItems,
  coreWebVitalsItems,
  linksItems,
  reportOpportunityItems,
  healthScore,
} from "@/Modules/SearchConsole/Values/actionFeedRules"
import type { ActionFeedSummary } from "@/Modules/SearchConsole/Types"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * Aggregates all seven Search Console data sources into one prioritized
 * list — see dev-docs/superpowers/specs/2026-08-06-search-console-action-feed-and-profile-design.md.
 * Every summary is fetched via the same in-process functions each source's
 * own route already exports, so this makes no additional Google API calls
 * beyond what those routes' own caching already allows.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate
  const userId = session.user.id

  try {
    const [pageIndexing, sitemaps, enhancements, cwv, links, issues, report, knownPosts] = await Promise.all([
      getPageIndexingSummary(),
      getSitemapsSummary(),
      getEnhancementsSummary(),
      getCoreWebVitalsSummary("mobile"),
      getLinksReport(),
      getOpenIssues(),
      getSitePerformanceSummary({ days: 28 }),
      getKnownPublishedPostsMeta(),
    ])

    const postIdByUrl = new Map<string, string>(knownPosts.map((post) => [post.url, post.id]))
    const viewerAuthoredPostIds = knownPosts.filter((post) => post.authorId === userId).map((post) => post.id)

    // The rule modules emit admin-RELATIVE hrefs so they stay pure functions of
    // their inputs, with no dependency on how this installation is configured.
    // The configured root is applied once, here at the boundary, so the client
    // receives links it can navigate to directly.
    const items = [
      ...issuesLogItems(issues, postIdByUrl),
      ...pageIndexingItems(pageIndexing, postIdByUrl),
      ...sitemapsItems(sitemaps),
      ...enhancementsItems(enhancements, postIdByUrl),
      ...coreWebVitalsItems(cwv, postIdByUrl),
      ...linksItems(links),
      ...reportOpportunityItems(report, postIdByUrl),
    ].map((item) => (item.href ? { ...item, href: adminPath(item.href) } : item))

    const notConnected = pageIndexing.status === "not_connected"
    const data: ActionFeedSummary = {
      status: notConnected ? "not_connected" : "ok",
      reason: notConnected ? pageIndexing.reason : null,
      checkedAt: new Date().toISOString(),
      items,
      healthScore: healthScore(items),
      viewerAuthoredPostIds,
    }

    return NextResponse.json({ data, message: "Action feed loaded" })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not build the action feed."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
