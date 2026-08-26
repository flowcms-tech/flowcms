import { NextRequest, NextResponse } from "next/server"
import { getBingConfig } from "@/Framework/Settings/SettingsService"
import { getRankAndTrafficStats, getQueryStats, getPageStats, getQueryPageDetailStats, type BingRankAndTrafficStat, type BingQueryStat, type BingPageStat } from "@/Framework/Integrations/BingWebmaster/traffic"
import { BingApiError } from "@/Framework/Integrations/BingWebmaster/client"
import { CacheService } from "@/Framework/Redis/CacheService"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

const CACHE_TTL_SECONDS = 6 * 60 * 60

export interface BingTrafficSummary {
  status: "ok" | "not_connected"
  reason: string | null
  siteUrl: string
  series: BingRankAndTrafficStat[]
  topQueries: BingQueryStat[]
  topPages: BingPageStat[]
}

function empty(reason: string): BingTrafficSummary {
  return { status: "not_connected", reason, siteUrl: "", series: [], topQueries: [], topPages: [] }
}

export async function getBingTrafficSummary(): Promise<BingTrafficSummary> {
  const bing = await getBingConfig()

  // Not a 422: the request is valid, the integration just isn't set up —
  // the correct UI response is "connect it under Settings", not a red toast.
  if (!bing.apiKey) {
    return empty("Bing Webmaster Tools is not connected. Connect it under Settings → Integrations.")
  }
  if (!bing.siteUrl) {
    return empty("Bing Webmaster Tools is connected but no site is selected. Pick one under Settings → Integrations.")
  }

  const apiKey = bing.apiKey
  const siteUrl = bing.siteUrl

  return CacheService.remember(`bing:traffic:${siteUrl}`, CACHE_TTL_SECONDS, async () => {
    const [series, topQueries, topPages] = await Promise.all([
      getRankAndTrafficStats(apiKey, siteUrl),
      getQueryStats(apiKey, siteUrl),
      getPageStats(apiKey, siteUrl),
    ])
    return { status: "ok" as const, reason: null, siteUrl, series, topQueries, topPages }
  })
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const query = request.nextUrl.searchParams.get("query")
  const page = request.nextUrl.searchParams.get("page")

  try {
    // Query × page drill-in: same route, distinguished by both params being
    // present, rather than a second endpoint for one on-demand detail call.
    if (query && page) {
      const bing = await getBingConfig()
      if (!bing.apiKey || !bing.siteUrl) {
        return NextResponse.json({ message: ["Bing Webmaster Tools is not connected."] }, { status: 422 })
      }
      const data = await getQueryPageDetailStats(bing.apiKey, bing.siteUrl, query, page)
      return NextResponse.json({ data, message: "Bing query/page detail loaded" })
    }

    const data = await getBingTrafficSummary()
    return NextResponse.json({ data, message: "Bing traffic loaded" })
  } catch (err) {
    const message = err instanceof BingApiError || err instanceof Error
      ? err.message
      : "Could not reach Bing Webmaster Tools."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
