import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getBaseUrl, getGscConfig, getGscRedirectUri } from "@/Framework/Settings/SettingsService"
import { querySearchAnalytics, type GscAnalyticsRow } from "@/Framework/Integrations/GoogleSearchConsole"
import { CacheService } from "@/Framework/Redis/CacheService"
import type { PagePerformance } from "@/Modules/Blog/Posts/Types/insights"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * Search Console performance for one page.
 *
 * Cached in Redis for 6 hours, keyed by URL + date range. GSC finalises data
 * 2–3 days late and the API has a per-project quota, so refetching on every
 * open of the Insights tab would burn that quota re-fetching numbers that
 * cannot have changed since the last call.
 */
const CACHE_TTL_SECONDS = 6 * 60 * 60

/** Google has usually finalised data through T-2. Ending the window at today
 *  would append two mostly-empty days to every chart and make a healthy post
 *  look like it fell off a cliff. */
const DATA_LAG_DAYS = 2

const WINDOW_DAYS = 90

const TOP_QUERY_LIMIT = 25

const querySchema = z.object({
  /** Absolute URL, or a site-relative path resolved against the configured
   *  base URL. The path form exists so a client only has to know the slug —
   *  the base URL lives in settings and the client should not be assembling it
   *  from a second source that can disagree. */
  url: z.string().trim().min(1, "A page URL is required."),
})

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function daysAgo(days: number): Date {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date
}

function empty(status: PagePerformance["status"], reason: string | null, pageUrl: string): PagePerformance {
  return {
    status,
    reason,
    pageUrl,
    startDate: "",
    endDate: "",
    lagDays: DATA_LAG_DAYS,
    totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    series: [],
    queries: [],
  }
}

/** Google omits days with no impressions entirely. Left as-is, recharts would
 *  join two points a fortnight apart with a straight line and imply traffic
 *  that never happened, so every day in the window gets an explicit zero. */
function fillMissingDays(rows: GscAnalyticsRow[], startDate: string, endDate: string) {
  const byDate = new Map(rows.map((row) => [row.keys[0], row]))
  const series: PagePerformance["series"] = []

  const cursor = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  while (cursor <= end) {
    const key = isoDate(cursor)
    const row = byDate.get(key)
    series.push({ date: key, clicks: row?.clicks ?? 0, impressions: row?.impressions ?? 0 })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return series
}

/** Shared with the Page Profile route. `rawUrlOrPath` may be a site-relative
 *  path — resolved against the configured base URL, same as the query-param
 *  form below. */
export async function getPagePerformance(rawUrlOrPath: string): Promise<PagePerformance> {
  const [baseUrl, gsc, redirectUri] = await Promise.all([
    getBaseUrl(),
    getGscConfig(),
    getGscRedirectUri(),
  ])

  const pageUrl = /^https?:\/\//i.test(rawUrlOrPath) ? rawUrlOrPath : `${baseUrl}${rawUrlOrPath.startsWith("/") ? "" : "/"}${rawUrlOrPath}`

  // Not a 422: the request is perfectly valid, the integration just isn't set
  // up. A validation error here would render as a red toast on a screen where
  // the correct message is "connect Search Console in Settings".
  if (!gsc.clientId || !gsc.clientSecret || !gsc.refreshToken) {
    return empty("not_connected", "Search Console is not connected. Connect it under Settings → Integrations.", pageUrl)
  }
  if (!gsc.siteUrl) {
    return empty("not_connected", "Search Console is connected but no property is selected. Pick one under Settings → Integrations.", pageUrl)
  }

  // Narrowed into consts so the closure below keeps the non-null types the
  // guards above just established — TypeScript drops that narrowing across a
  // function boundary.
  const refreshToken = gsc.refreshToken
  const siteUrl = gsc.siteUrl

  const endDate = isoDate(daysAgo(DATA_LAG_DAYS))
  const startDate = isoDate(daysAgo(DATA_LAG_DAYS + WINDOW_DAYS - 1))
  const cacheKey = `gsc:page-performance:${siteUrl}:${pageUrl}:${startDate}:${endDate}`

  return CacheService.remember<PagePerformance>(cacheKey, CACHE_TTL_SECONDS, async () => {
    const credentials = {
      clientId: gsc.clientId,
      clientSecret: gsc.clientSecret,
      redirectUri,
    }
    const window = { startDate, endDate, pageUrl: pageUrl }

    // Three calls rather than deriving the totals from the daily rows: the
    // average position Google reports is impression-weighted across the whole
    // window, and re-deriving it from per-day averages gives a subtly
    // different number than Search Console's own UI shows for the same page.
    // A panel that disagrees with GSC by half a position is a support ticket.
    const [totalRows, dateRows, queryRows] = await Promise.all([
      querySearchAnalytics(credentials, refreshToken, siteUrl, window),
      querySearchAnalytics(credentials, refreshToken, siteUrl, {
        ...window,
        dimensions: ["date"],
        rowLimit: WINDOW_DAYS,
      }),
      querySearchAnalytics(credentials, refreshToken, siteUrl, {
        ...window,
        dimensions: ["query"],
        rowLimit: TOP_QUERY_LIMIT,
      }),
    ])

    const totals = totalRows[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 }

    return {
      status: totals.impressions > 0 ? "ok" : "no_data",
      reason: null,
      pageUrl,
      startDate,
      endDate,
      lagDays: DATA_LAG_DAYS,
      totals: {
        clicks: totals.clicks,
        impressions: totals.impressions,
        ctr: totals.ctr,
        position: totals.position,
      },
      series: fillMissingDays(dateRows, startDate, endDate),
      queries: queryRows
        .map((row) => ({
          query: row.keys[0] ?? "",
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
        }))
        .sort((a, b) => b.impressions - a.impressions),
    }
  })
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const parsed = querySchema.safeParse({ url: request.nextUrl.searchParams.get("url") ?? "" })
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  try {
    const data = await getPagePerformance(parsed.data.url)
    if (data.status === "not_connected") {
      const message = data.reason?.includes("no property is selected")
        ? "No Search Console property selected"
        : "Search Console is not connected"
      return NextResponse.json({ data, message })
    }
    return NextResponse.json({ data, message: "Page performance loaded" })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach Google Search Console."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
