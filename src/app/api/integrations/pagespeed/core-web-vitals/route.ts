import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getBaseUrl, getPageSpeedConfig } from "@/Framework/Settings/SettingsService"
import { runPageSpeed, type CwvResult } from "@/Framework/Integrations/PageSpeedInsights"
import { getKnownPublishedPostUrls, mapWithConcurrency } from "@/Framework/Integrations/knownPageInspections"
import { CacheService } from "@/Framework/Redis/CacheService"
import type { CwvPageRow, CwvStrategy, CwvSummary } from "@/Modules/SearchConsole/Types"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * Core Web Vitals — from PageSpeed Insights v5, a separate API from Search
 * Console (no Core Web Vitals endpoint exists there). API-key auth, not
 * OAuth, configured independently under Settings → Integrations.
 */

/** Field data (the CrUX report this API surfaces) is a 28-day rolling
 *  average — it does not move within a day, so a day-long cache is
 *  generous, not stale. */
const CWV_CACHE_TTL_SECONDS = 24 * 60 * 60

/** Each PageSpeed Insights call runs a real Lighthouse pass server-side and
 *  routinely takes 5-15+ seconds — a handful in flight keeps a full-site
 *  run from timing out without looking like abuse of a free API. */
const CONCURRENCY = 3

function empty(status: CwvSummary["status"], reason: string | null, strategy: CwvStrategy): CwvSummary {
  return {
    status,
    reason,
    strategy,
    checkedAt: null,
    goodCount: 0,
    needsImprovementCount: 0,
    poorCount: 0,
    erroredCount: 0,
    pages: [],
    totalKnownPages: 0,
    inspectedCount: 0,
  }
}

function toRow(result: CwvResult): CwvPageRow {
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

function errorRow(url: string, error: unknown): CwvPageRow {
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
    error: error instanceof Error ? error.message : "Could not run PageSpeed Insights for this URL.",
  }
}

function parseStrategy(raw: string | null): CwvStrategy {
  return raw === "desktop" ? "desktop" : "mobile"
}

/** Shared with the Action Feed route. */
export async function getCoreWebVitalsSummary(strategy: CwvStrategy, options: { forceRefresh?: boolean } = {}): Promise<CwvSummary> {
  const forceRefresh = options.forceRefresh ?? false

  const { apiKey: configuredApiKey } = await getPageSpeedConfig()
  if (!configuredApiKey) {
    return empty("not_configured", "PageSpeed Insights is not configured. Add an API key under Settings → Integrations.", strategy)
  }
  const apiKey: string = configuredApiKey

  const { urls, totalKnownPages } = await getKnownPublishedPostUrls()
  if (urls.length === 0) {
    return empty("no_pages", "No published posts yet — there's nothing to test.", strategy)
  }

  async function getResult(url: string): Promise<CwvResult> {
    const cacheKey = `gsc:cwv:${strategy}:${url}`
    if (forceRefresh) {
      const fresh = await runPageSpeed(apiKey, url, strategy)
      await CacheService.setJson(cacheKey, fresh, CWV_CACHE_TTL_SECONDS)
      return fresh
    }
    return CacheService.remember(cacheKey, CWV_CACHE_TTL_SECONDS, () => runPageSpeed(apiKey, url, strategy))
  }

  const pages = await mapWithConcurrency(urls, CONCURRENCY, async (url): Promise<CwvPageRow> => {
    try {
      return toRow(await getResult(url))
    } catch (err) {
      return errorRow(url, err)
    }
  })

  const goodCount = pages.filter((p) => p.overallCategory === "FAST").length
  const needsImprovementCount = pages.filter((p) => p.overallCategory === "AVERAGE").length
  const poorCount = pages.filter((p) => p.overallCategory === "SLOW").length
  const erroredCount = pages.filter((p) => p.error).length

  return {
    status: "ok",
    reason: null,
    strategy,
    checkedAt: new Date().toISOString(),
    goodCount,
    needsImprovementCount,
    poorCount,
    erroredCount,
    pages,
    totalKnownPages,
    inspectedCount: urls.length,
  }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const strategy = parseStrategy(request.nextUrl.searchParams.get("strategy"))
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1"

  const data = await getCoreWebVitalsSummary(strategy, { forceRefresh })
  if (data.status === "not_configured") {
    return NextResponse.json({ data, message: "PageSpeed Insights is not configured" })
  }
  if (data.status === "no_pages") {
    return NextResponse.json({ data, message: "No published pages" })
  }
  return NextResponse.json({ data, message: "Core Web Vitals loaded" })
}

const adHocSchema = z.object({
  url: z.string().trim().min(1, "A URL is required."),
  strategy: z.enum(["mobile", "desktop"]).default("mobile"),
})

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const parsed = adHocSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues.map((issue) => issue.message) }, { status: 422 })
  }

  const { apiKey } = await getPageSpeedConfig()
  if (!apiKey) {
    return NextResponse.json(
      { message: ["PageSpeed Insights is not configured — add an API key under Settings → Integrations."] },
      { status: 422 }
    )
  }

  const baseUrl = await getBaseUrl()
  const raw = parsed.data.url
  const url = /^https?:\/\//i.test(raw) ? raw : `${baseUrl}${raw.startsWith("/") ? "" : "/"}${raw}`
  const strategy = parsed.data.strategy
  const cacheKey = `gsc:cwv:${strategy}:${url}`

  try {
    const result = await CacheService.remember(cacheKey, CWV_CACHE_TTL_SECONDS, () => runPageSpeed(apiKey, url, strategy))
    return NextResponse.json({ data: toRow(result), message: "PageSpeed check complete" })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not run PageSpeed Insights for this URL."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
