import "server-only"
import { bingGet, parseBingDate, quoteBingString as quoteParam } from "./client"

/**
 * Traffic & Rank — GetRankAndTrafficStats, GetQueryStats, GetQueryTrafficStats,
 * GetQueryPageStats, GetQueryPageDetailStats, GetPageStats, GetPageQueryStats.
 *
 * Confirmed against each method's Microsoft Learn REST reference. Every
 * `query`/`page` string param below is passed through `quoteBingString`
 * (see `client.ts`) — Bing's JSON REST samples show those values
 * JSON-quoted in the query string, while `siteUrl` is never quoted.
 */

export interface BingRankAndTrafficStat {
  date: string | null
  clicks: number
  impressions: number
}

interface RawRankAndTrafficStats {
  Clicks: number
  Date: string
  Impressions: number
}

function toRankAndTrafficStat(raw: RawRankAndTrafficStats): BingRankAndTrafficStat {
  return { date: parseBingDate(raw.Date), clicks: raw.Clicks, impressions: raw.Impressions }
}

/** Traffic statistics (clicks/impressions per day) for the whole site. */
export async function getRankAndTrafficStats(apiKey: string, siteUrl: string): Promise<BingRankAndTrafficStat[]> {
  const raw = await bingGet<RawRankAndTrafficStats[]>("GetRankAndTrafficStats", apiKey, { siteUrl })
  return (raw ?? []).map(toRankAndTrafficStat)
}

/** Same shape, scoped to one query — "only top-queries will be saved and
 *  returned by this method" per Bing's own docs. */
export async function getQueryTrafficStats(
  apiKey: string,
  siteUrl: string,
  query: string
): Promise<BingRankAndTrafficStat[]> {
  const raw = await bingGet<RawRankAndTrafficStats[]>("GetQueryTrafficStats", apiKey, {
    siteUrl,
    query: quoteParam(query),
  })
  return (raw ?? []).map(toRankAndTrafficStat)
}

export interface BingQueryStat {
  query: string
  date: string | null
  clicks: number
  impressions: number
  avgClickPosition: number
  avgImpressionPosition: number
}

interface RawQueryStats {
  AvgClickPosition: number
  AvgImpressionPosition: number
  Clicks: number
  Date: string
  Impressions: number
  /** Reused across methods: query text for GetQueryStats/GetQueryPageStats/
   *  GetPageQueryStats, but a page URL for GetPageStats (per Bing's own
   *  sample: `"Query":"PageURL"`) — mapped to the right field name by each
   *  wrapper below rather than exposed as this ambiguous shared name. */
  Query: string
}

function toQueryStat(raw: RawQueryStats): BingQueryStat {
  return {
    query: raw.Query,
    date: parseBingDate(raw.Date),
    clicks: raw.Clicks,
    impressions: raw.Impressions,
    avgClickPosition: raw.AvgClickPosition,
    avgImpressionPosition: raw.AvgImpressionPosition,
  }
}

/** Top queries for the whole site, with position data. */
export async function getQueryStats(apiKey: string, siteUrl: string): Promise<BingQueryStat[]> {
  const raw = await bingGet<RawQueryStats[]>("GetQueryStats", apiKey, { siteUrl })
  return (raw ?? []).map(toQueryStat)
}

/** Per-day stats for one query, across the pages it matched. */
export async function getQueryPageStats(apiKey: string, siteUrl: string, query: string): Promise<BingQueryStat[]> {
  const raw = await bingGet<RawQueryStats[]>("GetQueryPageStats", apiKey, { siteUrl, query: quoteParam(query) })
  return (raw ?? []).map(toQueryStat)
}

export interface BingPageStat {
  /** The page URL — `query` is Bing's field name for this method too (see
   *  RawQueryStats' comment), renamed here to match what it actually holds. */
  pageUrl: string
  date: string | null
  clicks: number
  impressions: number
  avgClickPosition: number
  avgImpressionPosition: number
}

function toPageStat(raw: RawQueryStats): BingPageStat {
  return {
    pageUrl: raw.Query,
    date: parseBingDate(raw.Date),
    clicks: raw.Clicks,
    impressions: raw.Impressions,
    avgClickPosition: raw.AvgClickPosition,
    avgImpressionPosition: raw.AvgImpressionPosition,
  }
}

/** Top pages for the whole site, with position data. */
export async function getPageStats(apiKey: string, siteUrl: string): Promise<BingPageStat[]> {
  const raw = await bingGet<RawQueryStats[]>("GetPageStats", apiKey, { siteUrl })
  return (raw ?? []).map(toPageStat)
}

/** Per-query stats for one page. */
export async function getPageQueryStats(apiKey: string, siteUrl: string, page: string): Promise<BingQueryStat[]> {
  const raw = await bingGet<RawQueryStats[]>("GetPageQueryStats", apiKey, { siteUrl, page: quoteParam(page) })
  return (raw ?? []).map(toQueryStat)
}

export interface BingDetailedQueryStat {
  date: string | null
  clicks: number
  impressions: number
  position: number
}

interface RawDetailedQueryStats {
  Clicks: number
  Date: string
  Impressions: number
  Position: number
}

/** Per-day clicks/impressions/position for one query × page pair — the
 *  cross-tab drill-in from the Traffic screen's query and page tables. */
export async function getQueryPageDetailStats(
  apiKey: string,
  siteUrl: string,
  query: string,
  page: string
): Promise<BingDetailedQueryStat[]> {
  const raw = await bingGet<RawDetailedQueryStats[]>("GetQueryPageDetailStats", apiKey, {
    siteUrl,
    query: quoteParam(query),
    page: quoteParam(page),
  })
  return (raw ?? []).map((row) => ({
    date: parseBingDate(row.Date),
    clicks: row.Clicks,
    impressions: row.Impressions,
    position: row.Position,
  }))
}
