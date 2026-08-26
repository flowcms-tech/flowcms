import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPosts, searchConsoleIssues } from "@/db/tables"
import { getBaseUrl, getPageSpeedConfig } from "@/Framework/Settings/SettingsService"
import { runPageSpeed } from "@/Framework/Integrations/PageSpeedInsights"
import { getInspectionForUrl } from "@/Framework/Integrations/knownPageInspections"
import { getPagePerformance } from "@/app/api/integrations/google-search-console/page-performance/route"
import { getLinksReport } from "@/app/api/links-report/route"
import { serialize as serializeIssue } from "@/app/api/search-console-issues/route"
import { toUrlInspectionRow } from "@/Modules/SearchConsole/Values/inspection"
import { CacheService } from "@/Framework/Redis/CacheService"
import type { CwvPageRow, PageProfile } from "@/Modules/SearchConsole/Types"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/** Same TTL as Core Web Vitals' own cache — field data doesn't move
 *  within a day, so this isn't stale, and reusing the exact key format
 *  means a page already checked from that screen is a cache hit here too. */
const CWV_CACHE_TTL_SECONDS = 24 * 60 * 60

function toCwvRow(url: string, result: Awaited<ReturnType<typeof runPageSpeed>> | null, error: string | null): CwvPageRow | null {
  if (error) {
    return {
      url,
      overallCategory: null,
      performanceScore: null,
      lcp: { percentile: null, category: null },
      cls: { percentile: null, category: null },
      inp: { percentile: null, category: null },
      fcp: { percentile: null, category: null },
      labLcpMs: null,
      labCls: null,
      labTbtMs: null,
      error,
    }
  }
  if (!result) return null
  return {
    url: result.url,
    overallCategory: result.overallCategory,
    performanceScore: result.performanceScore,
    lcp: result.metrics.lcp,
    cls: result.metrics.cls,
    inp: result.metrics.inp,
    fcp: result.metrics.fcp,
    labLcpMs: result.labLcpMs,
    labCls: result.labCls,
    labTbtMs: result.labTbtMs,
    error: null,
  }
}

/** A single inspection failing (rate limit, or — in local dev — a URL that
 *  simply isn't part of the connected property) must degrade this one
 *  section to "not available", not sink the whole profile the way an
 *  unhandled `Promise.all` rejection would. */
async function safeInspection(url: string): ReturnType<typeof getInspectionForUrl> {
  try {
    return await getInspectionForUrl(url)
  } catch (err) {
    return { status: "not_connected", reason: err instanceof Error ? err.message : "Could not inspect this URL." }
  }
}

async function safePagePerformance(url: string): ReturnType<typeof getPagePerformance> {
  try {
    return await getPagePerformance(url)
  } catch {
    return {
      status: "not_connected",
      reason: "Could not reach Google Search Console.",
      pageUrl: url,
      startDate: "",
      endDate: "",
      lagDays: 0,
      totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      series: [],
      queries: [],
    }
  }
}

async function safeLinksReport(): ReturnType<typeof getLinksReport> {
  try {
    return await getLinksReport()
  } catch {
    return { status: "no_pages", checkedAt: null, internalLinks: [], externalLinks: [], zeroInboundPosts: [], totalPosts: 0 }
  }
}

async function resolveCwv(url: string, strategy: "mobile" | "desktop"): Promise<CwvPageRow | null> {
  const { apiKey } = await getPageSpeedConfig()
  if (!apiKey) return null

  const cacheKey = `gsc:cwv:${strategy}:${url}`
  try {
    const result = await CacheService.remember(cacheKey, CWV_CACHE_TTL_SECONDS, () => runPageSpeed(apiKey, url, strategy))
    return toCwvRow(url, result, null)
  } catch (err) {
    return toCwvRow(url, null, err instanceof Error ? err.message : "Could not run PageSpeed Insights for this URL.")
  }
}

/**
 * Everything Search Console's seven data sources know about one URL, joined
 * on one screen — see dev-docs/superpowers/specs/2026-08-06-search-console-action-feed-and-profile-design.md.
 * Every piece is resolved via the same in-process functions/caches each
 * source's own screen already uses; no additional Google API calls beyond
 * what those already allow.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const postId = request.nextUrl.searchParams.get("postId")
  const rawUrl = request.nextUrl.searchParams.get("url")

  if (!postId && !rawUrl) {
    return NextResponse.json({ message: ["A postId or url is required."] }, { status: 422 })
  }

  let resolvedPostId: string | null = null
  let title: string | null = null
  let url: string

  if (postId) {
    const post = await db.query.blogPosts.findFirst({
      where: eq(blogPosts.id, postId),
      columns: { id: true, slug: true, title: true },
    })
    if (!post) {
      return NextResponse.json({ message: ["Post not found."] }, { status: 404 })
    }
    const baseUrl = await getBaseUrl()
    resolvedPostId = post.id
    title = post.title
    url = `${baseUrl}/blog/${post.slug}`
  } else {
    const baseUrl = await getBaseUrl()
    const raw = rawUrl!
    url = /^https?:\/\//i.test(raw) ? raw : `${baseUrl}${raw.startsWith("/") ? "" : "/"}${raw}`

    // An ad-hoc URL might still be a known post — resolve it the same way so
    // the profile links back into the post editor and scopes issues the same
    // as the postId path would.
    const match = await db.query.blogPosts.findFirst({
      where: eq(blogPosts.slug, url.split("/blog/")[1]?.split(/[?#]/)[0] ?? ""),
      columns: { id: true, title: true },
    })
    if (match) {
      resolvedPostId = match.id
      title = match.title
    }
  }

  try {
    const [performance, inspectionResult, mobileCwv, desktopCwv, linksReport, relatedIssueRows] = await Promise.all([
      safePagePerformance(url),
      safeInspection(url),
      resolveCwv(url, "mobile"),
      resolveCwv(url, "desktop"),
      safeLinksReport(),
      db.query.searchConsoleIssues.findMany({ where: eq(searchConsoleIssues.url, url) }),
    ])

    const internalInbound = resolvedPostId
      ? linksReport.status === "ok"
        ? (linksReport.internalLinks.find((row) => row.targetId === resolvedPostId) ?? null)
        : null
      : null

    const externalOutbound = resolvedPostId && linksReport.status === "ok"
      ? Array.from(
          new Set(
            linksReport.externalLinks
              .filter((row) => row.sourcePosts.some((p) => p.id === resolvedPostId))
              .flatMap((row) => row.urls)
          )
        )
      : []

    const data: PageProfile = {
      postId: resolvedPostId,
      url,
      title,
      performance: performance.status === "not_connected" ? null : { totals: performance.totals, series: performance.series },
      inspection: inspectionResult.status === "ok" ? toUrlInspectionRow(url, inspectionResult.inspection) : null,
      coreWebVitals: { mobile: mobileCwv, desktop: desktopCwv },
      internalInbound,
      externalOutbound,
      relatedIssues: relatedIssueRows.map(serializeIssue),
    }

    return NextResponse.json({ data, message: "Page profile loaded" })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not build the page profile."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
