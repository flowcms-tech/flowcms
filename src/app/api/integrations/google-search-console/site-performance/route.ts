import { NextRequest, NextResponse } from "next/server"
import { getGscConfig } from "@/Framework/Settings/SettingsService"
import { querySearchAnalytics, type GscAnalyticsRow } from "@/Framework/Integrations/GoogleSearchConsole"
import { CacheService } from "@/Framework/Redis/CacheService"
import { WINDOW_DAY_OPTIONS, DEFAULT_WINDOW_DAYS, type GscSiteDashboard, type WindowDays } from "@/Modules/SearchConsole/Types"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * Site-wide Search Console performance for the dashboard widget.
 *
 * Same shape of route as page-performance, minus the `pageUrl` filter and
 * plus a "page" dimension query for the top-pages table — cached in Redis
 * for the same reason: GSC finalises data 2–3 days late and the API has a
 * per-project quota, so refetching on every dashboard visit would burn that
 * quota re-fetching numbers that cannot have changed.
 */
const CACHE_TTL_SECONDS = 6 * 60 * 60

/** Google has usually finalised data through T-2. Ending the window at today
 *  would append two mostly-empty days to every chart. */
const DATA_LAG_DAYS = 2

/** Generous enough to cover realistic query/page counts for a small
 *  business site while paginating client-side in the table — GSC allows up
 *  to 25000 per call, but the dashboard doesn't need a deep archive, just
 *  more than one page's worth. */
const ROW_LIMIT = 250

const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function parseWindowDays(raw: string | null): WindowDays {
  const parsed = Number(raw)
  return (WINDOW_DAY_OPTIONS as readonly number[]).includes(parsed) ? (parsed as WindowDays) : DEFAULT_WINDOW_DAYS
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function daysAgo(days: number): Date {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date
}

function daysBetweenInclusive(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
}

/**
 * `from`/`to` win over `days` when both are present and well-formed — an
 * explicit custom range is a stronger signal than the preset that happens to
 * still be in the URL from a previous request.
 *
 * Clamped rather than rejected: Google can't report on today/yesterday
 * (DATA_LAG_DAYS) or a date after it, and a stale "to" from a range picked
 * yesterday is a normal, not exceptional, thing to receive.
 */
function parseCustomRange(searchParams: URLSearchParams): { startDate: string; endDate: string } | null {
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  if (!from || !to || !YMD_PATTERN.test(from) || !YMD_PATTERN.test(to)) return null

  const maxEnd = isoDate(daysAgo(DATA_LAG_DAYS))
  const endDate = to > maxEnd ? maxEnd : to
  const startDate = from > endDate ? endDate : from
  return { startDate, endDate }
}

function empty(status: GscSiteDashboard["status"], reason: string | null, siteUrl: string): GscSiteDashboard {
  return {
    status,
    reason,
    siteUrl,
    startDate: "",
    endDate: "",
    lagDays: DATA_LAG_DAYS,
    totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    series: [],
    topQueries: [],
    topPages: [],
    topCountries: [],
    topDevices: [],
    topSearchAppearances: [],
    byDate: [],
  }
}

/** Google omits days with no impressions entirely. Left as-is, the chart
 *  would join two points a week apart with a straight line and imply traffic
 *  that never happened, so every day in the window gets an explicit zero. */
function fillMissingDays(rows: GscAnalyticsRow[], startDate: string, endDate: string) {
  const byDate = new Map(rows.map((row) => [row.keys[0], row]))
  const series: GscSiteDashboard["series"] = []

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

/** Shared with the Action Feed route, which always wants a fixed trailing
 *  window and has no use for the custom-range parsing below — that stays in
 *  the route, only the resolved-range fetch+cache is shared. */
export async function getSitePerformanceSummary(range: { startDate: string; endDate: string } | { days: number }): Promise<GscSiteDashboard> {
  const gsc = await getGscConfig()

  // Not a 422: the request is perfectly valid, the integration just isn't set
  // up. A validation error here would render as a red toast on a screen where
  // the correct message is "connect Search Console in Settings".
  if (!gsc.clientId || !gsc.clientSecret || !gsc.refreshToken) {
    return empty("not_connected", "Search Console is not connected. Connect it under Settings → Integrations.", "")
  }
  if (!gsc.siteUrl) {
    return empty("not_connected", "Search Console is connected but no property is selected. Pick one under Settings → Integrations.", "")
  }

  const refreshToken = gsc.refreshToken
  const siteUrl = gsc.siteUrl

  const endDate = "endDate" in range ? range.endDate : isoDate(daysAgo(DATA_LAG_DAYS))
  const startDate = "startDate" in range ? range.startDate : isoDate(daysAgo(DATA_LAG_DAYS + range.days - 1))
  const dayCount = "endDate" in range ? daysBetweenInclusive(startDate, endDate) : range.days
  const cacheKey = `gsc:site-performance:${siteUrl}:${startDate}:${endDate}`

  return CacheService.remember<GscSiteDashboard>(cacheKey, CACHE_TTL_SECONDS, async () => {
      const { getGscRedirectUri } = await import("@/Framework/Settings/SettingsService")
      const credentials = {
        clientId: gsc.clientId,
        clientSecret: gsc.clientSecret,
        redirectUri: await getGscRedirectUri(),
      }
      const window = { startDate, endDate }

      // Seven calls rather than deriving totals from the daily rows: the
      // average position Google reports is impression-weighted across the
      // whole window, and re-deriving it from per-day averages gives a
      // subtly different number than Search Console's own UI.
      const [totalRows, dateRows, queryRows, pageRows, countryRows, deviceRows, searchAppearanceRows] =
        await Promise.all([
          querySearchAnalytics(credentials, refreshToken, siteUrl, window),
          querySearchAnalytics(credentials, refreshToken, siteUrl, {
            ...window,
            dimensions: ["date"],
            rowLimit: dayCount,
          }),
          querySearchAnalytics(credentials, refreshToken, siteUrl, {
            ...window,
            dimensions: ["query"],
            rowLimit: ROW_LIMIT,
          }),
          querySearchAnalytics(credentials, refreshToken, siteUrl, {
            ...window,
            dimensions: ["page"],
            rowLimit: ROW_LIMIT,
          }),
          querySearchAnalytics(credentials, refreshToken, siteUrl, {
            ...window,
            dimensions: ["country"],
            rowLimit: ROW_LIMIT,
          }),
          querySearchAnalytics(credentials, refreshToken, siteUrl, {
            ...window,
            dimensions: ["device"],
            rowLimit: ROW_LIMIT,
          }),
          querySearchAnalytics(credentials, refreshToken, siteUrl, {
            ...window,
            dimensions: ["searchAppearance"],
            rowLimit: ROW_LIMIT,
          }),
        ])

      const totals = totalRows[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 }

      return {
        status: totals.impressions > 0 ? "ok" : "no_data",
        reason: null,
        siteUrl,
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
        topQueries: queryRows
          .map((row) => ({
            query: row.keys[0] ?? "",
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
          }))
          .sort((a, b) => b.impressions - a.impressions),
        topPages: pageRows
          .map((row) => ({
            page: row.keys[0] ?? "",
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
          }))
          .sort((a, b) => b.impressions - a.impressions),
        topCountries: countryRows
          .map((row) => ({
            country: row.keys[0] ?? "",
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
          }))
          .sort((a, b) => b.impressions - a.impressions),
        topDevices: deviceRows
          .map((row) => ({
            device: row.keys[0] ?? "",
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
          }))
          .sort((a, b) => b.impressions - a.impressions),
        topSearchAppearances: searchAppearanceRows
          .map((row) => ({
            searchAppearance: row.keys[0] ?? "",
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
          }))
          .sort((a, b) => b.impressions - a.impressions),
        // Only days Google actually returned rows for — no zero-fill, unlike
        // `series`. A 90-day "Days" table padded with silent zero rows would
        // bury the days that actually happened.
        byDate: dateRows
          .map((row) => ({
            date: row.keys[0] ?? "",
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
          }))
          .sort((a, b) => (a.date < b.date ? 1 : -1)),
      } satisfies GscSiteDashboard
  })
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const customRange = parseCustomRange(request.nextUrl.searchParams)
  const windowDays = parseWindowDays(request.nextUrl.searchParams.get("days"))

  try {
    const data = await getSitePerformanceSummary(customRange ?? { days: windowDays })

    if (data.status === "not_connected") {
      const message = data.reason?.includes("no property is selected")
        ? "No Search Console property selected"
        : "Search Console is not connected"
      return NextResponse.json({ data, message })
    }

    return NextResponse.json({ data, message: "Site performance loaded" })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach Google Search Console."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
