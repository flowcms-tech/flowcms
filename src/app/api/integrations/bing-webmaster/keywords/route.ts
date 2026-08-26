import { NextRequest, NextResponse } from "next/server"
import { getBingConfig } from "@/Framework/Settings/SettingsService"
import { getKeywordStats, getRelatedKeywords } from "@/Framework/Integrations/BingWebmaster/keywords"
import { BingApiError } from "@/Framework/Integrations/BingWebmaster/client"
import { CacheService } from "@/Framework/Redis/CacheService"
import type { BingKeywordsSummary } from "@/Modules/BingWebmaster/Types/keywords"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

// GetKeyword/GetKeywordStats/GetRelatedKeywords are Bing-wide keyword
// research data, not scoped to a site — confirmed from the .NET interface
// signatures (no siteUrl parameter). country/language are still required by
// Bing's own signature; "en"/"us" is this route's default when the caller
// doesn't pick one, not a Bing-documented default.
const DEFAULT_COUNTRY = "us"
const DEFAULT_LANGUAGE = "en"
const RELATED_KEYWORDS_WINDOW_DAYS = 30
const CACHE_TTL_SECONDS = 6 * 60 * 60

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function empty(status: BingKeywordsSummary["status"], reason: string | null, query: string): BingKeywordsSummary {
  return { status, reason, query, stats: [], related: [] }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const query = request.nextUrl.searchParams.get("query")?.trim() ?? ""
  const country = request.nextUrl.searchParams.get("country")?.trim() || DEFAULT_COUNTRY
  const language = request.nextUrl.searchParams.get("language")?.trim() || DEFAULT_LANGUAGE

  if (!query) {
    return NextResponse.json({ data: empty("prompt", null, ""), message: "Search for a keyword" })
  }

  const bing = await getBingConfig()
  if (!bing.apiKey) {
    return NextResponse.json({
      data: empty(
        "not_connected",
        "Bing Webmaster Tools is not connected. Connect it under Settings → Integrations.",
        query
      ),
      message: "Not connected",
    })
  }

  const apiKey = bing.apiKey
  const cacheKey = `bing:keywords:${query.toLowerCase()}:${country}:${language}`

  try {
    const data = await CacheService.remember<BingKeywordsSummary>(cacheKey, CACHE_TTL_SECONDS, async () => {
      const endDate = isoDate(new Date())
      const startDate = isoDate(new Date(Date.now() - RELATED_KEYWORDS_WINDOW_DAYS * 24 * 60 * 60 * 1000))

      const [stats, related] = await Promise.all([
        getKeywordStats(apiKey, query, country, language),
        getRelatedKeywords(apiKey, query, country, language, startDate, endDate),
      ])

      return { status: "ok", reason: null, query, stats, related }
    })

    return NextResponse.json({ data, message: "Keyword data loaded" })
  } catch (err) {
    const message =
      err instanceof BingApiError || err instanceof Error ? err.message : "Could not reach Bing Webmaster Tools."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
