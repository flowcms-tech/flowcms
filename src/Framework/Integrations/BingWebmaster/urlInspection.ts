import "server-only"
import { bingGet, bingPost, parseBingDate, quoteBingString } from "./client"

/**
 * URL Inspection — GetUrlInfo/GetUrlTrafficInfo (single page or "domain:"
 * prefixed origin) and GetChildrenUrlInfo/GetChildrenUrlTrafficInfo (a
 * directory's contents). Field names confirmed against Microsoft Learn's
 * REST samples for each method. `url` is a String GET param and is quoted
 * via `quoteBingString` (confirmed from GetUrlInfo's own sample:
 * `url=%22example.com%22`) — `page` (UInt16) is not.
 */

export interface BingUrlInfo {
  url: string
  isPage: boolean
  anchorCount: number
  documentSize: number
  httpStatus: number
  totalChildUrlCount: number
  discoveryDate: string | null
  lastCrawledDate: string | null
}

export interface BingUrlTrafficInfo {
  url: string
  isPage: boolean
  clicks: number
  impressions: number
}

interface RawUrlInfo {
  Url: string
  IsPage: boolean
  AnchorCount: number
  DocumentSize: number
  HttpStatus: number
  TotalChildUrlCount: number
  DiscoveryDate: string | null
  LastCrawledDate: string | null
}

interface RawUrlTrafficInfo {
  Url: string
  IsPage: boolean
  Clicks: number
  Impressions: number
}

function mapUrlInfo(raw: RawUrlInfo): BingUrlInfo {
  return {
    url: raw.Url,
    isPage: raw.IsPage,
    anchorCount: raw.AnchorCount,
    documentSize: raw.DocumentSize,
    httpStatus: raw.HttpStatus,
    totalChildUrlCount: raw.TotalChildUrlCount,
    discoveryDate: parseBingDate(raw.DiscoveryDate),
    lastCrawledDate: parseBingDate(raw.LastCrawledDate),
  }
}

function mapUrlTrafficInfo(raw: RawUrlTrafficInfo): BingUrlTrafficInfo {
  return { url: raw.Url, isPage: raw.IsPage, clicks: raw.Clicks, impressions: raw.Impressions }
}

export async function getUrlInfo(apiKey: string, siteUrl: string, url: string): Promise<BingUrlInfo> {
  const raw = await bingGet<RawUrlInfo>("GetUrlInfo", apiKey, { siteUrl, url: quoteBingString(url) })
  return mapUrlInfo(raw)
}

export async function getUrlTrafficInfo(
  apiKey: string,
  siteUrl: string,
  url: string
): Promise<BingUrlTrafficInfo> {
  const raw = await bingGet<RawUrlTrafficInfo>("GetUrlTrafficInfo", apiKey, {
    siteUrl,
    url: quoteBingString(url),
  })
  return mapUrlTrafficInfo(raw)
}

/**
 * `filterProperties` is a required object of four sub-filters
 * (CrawlDateFilter, DiscoveredDateFilter, DocFlagsFilters, HttpCodeFilters).
 * Microsoft Learn's REST sample for GetChildrenUrlInfo shows
 * DiscoveredDateFilter/DocFlagsFilters/HttpCodeFilters all `0` labeled
 * "Any" in the equivalent XML sample, and CrawlDateFilter `1` labeled
 * "LastWeek" (a deliberate filter, not the default) — so `0` is inferred
 * to be each sub-filter's "no filter" value, including CrawlDateFilter.
 * This is an inference from the samples, not a confirmed enum reference
 * (Learn's FilterProperties/enum pages list only property names, no
 * value tables) — revisit if Bing's actual response set looks filtered
 * unexpectedly once a real API key is available.
 */
const DEFAULT_FILTER_PROPERTIES = {
  CrawlDateFilter: 0,
  DiscoveredDateFilter: 0,
  DocFlagsFilters: 0,
  HttpCodeFilters: 0,
}

export async function getChildrenUrlInfo(
  apiKey: string,
  siteUrl: string,
  url: string,
  page = 0
): Promise<BingUrlInfo[]> {
  const raw = await bingPost<RawUrlInfo[]>("GetChildrenUrlInfo", apiKey, {
    siteUrl,
    url,
    page,
    filterProperties: DEFAULT_FILTER_PROPERTIES,
  })
  return (raw ?? []).map(mapUrlInfo)
}

export async function getChildrenUrlTrafficInfo(
  apiKey: string,
  siteUrl: string,
  url: string,
  page = 0
): Promise<BingUrlTrafficInfo[]> {
  const raw = await bingGet<RawUrlTrafficInfo[]>("GetChildrenUrlTrafficInfo", apiKey, {
    siteUrl,
    url: quoteBingString(url),
    page: String(page),
  })
  return (raw ?? []).map(mapUrlTrafficInfo)
}
