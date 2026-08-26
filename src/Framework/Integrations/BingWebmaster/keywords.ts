import "server-only"
import { bingGet, parseBingDate, quoteBingString } from "./client"

/**
 * GetKeyword / GetKeywordStats / GetRelatedKeywords — confirmed from the
 * .NET interface signatures (Microsoft Learn) to take `q`/`country`/
 * `language` (+ a date range for GetKeyword/GetRelatedKeywords), NOT
 * `siteUrl` — this is Bing-wide keyword research data, not scoped to a
 * particular site, unlike every other category in this integration.
 *
 * Response field names (`BroadImpressions`, `Impressions`, `Query`, and
 * `Date` on KeywordStats) confirmed from the `Keyword`/`KeywordStats` type
 * reference pages. `q`/`country`/`language` are String params, quoted via
 * `quoteBingString` per the confirmed GetUrlInfo/GetQueryTrafficStats
 * pattern (see `client.ts`) — `startDate`/`endDate` are NOT quoted (Bing
 * treats DateTime params differently), and their exact wire format is
 * NOT confirmed from a live sample — Microsoft's docs page for
 * GetRelatedKeywords ships a mismatched (GetSiteRoles) example — so this
 * is the same ISO-date convention every other date param in this app
 * uses; verify against a live call once a real API key exists.
 */

interface BingKeywordRaw {
  Query: string
  Impressions: number
  BroadImpressions: number
}

interface BingKeywordStatsRaw extends BingKeywordRaw {
  Date: string
}

export interface BingKeyword extends Record<string, unknown> {
  query: string
  impressions: number
  broadImpressions: number
}

export interface BingKeywordStatsPoint extends BingKeyword {
  date: string | null
}

function toKeyword(raw: BingKeywordRaw): BingKeyword {
  return { query: raw.Query, impressions: raw.Impressions, broadImpressions: raw.BroadImpressions }
}

export async function getKeyword(
  apiKey: string,
  query: string,
  country: string,
  language: string,
  startDate: string,
  endDate: string
): Promise<BingKeyword> {
  const raw = await bingGet<BingKeywordRaw>("GetKeyword", apiKey, {
    q: quoteBingString(query),
    country: quoteBingString(country),
    language: quoteBingString(language),
    startDate,
    endDate,
  })
  return toKeyword(raw)
}

export async function getKeywordStats(
  apiKey: string,
  query: string,
  country: string,
  language: string
): Promise<BingKeywordStatsPoint[]> {
  const raw = await bingGet<BingKeywordStatsRaw[]>("GetKeywordStats", apiKey, {
    q: quoteBingString(query),
    country: quoteBingString(country),
    language: quoteBingString(language),
  })
  return (raw ?? []).map((point) => ({ ...toKeyword(point), date: parseBingDate(point.Date) }))
}

export async function getRelatedKeywords(
  apiKey: string,
  query: string,
  country: string,
  language: string,
  startDate: string,
  endDate: string
): Promise<BingKeyword[]> {
  const raw = await bingGet<BingKeywordRaw[]>("GetRelatedKeywords", apiKey, {
    q: quoteBingString(query),
    country: quoteBingString(country),
    language: quoteBingString(language),
    startDate,
    endDate,
  })
  return (raw ?? []).map(toKeyword)
}
