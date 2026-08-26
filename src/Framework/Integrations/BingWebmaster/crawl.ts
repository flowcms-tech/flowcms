import "server-only"
import { bingGet, bingPost, parseBingDate } from "./client"

/**
 * Confirmed from Bing's own REST samples (GetCrawlStats, GetCrawlIssues,
 * GetCrawlSettings, SaveCrawlSettings method pages on Microsoft Learn).
 *
 * CrawlSettings has a documented inconsistency between Bing's .NET property
 * listing (CrawlBoostAvailable, CrawlBoostEnabled, CrawlRate) and its own
 * REST JSON sample response (AjaxEnabled, CrawlRate) — both are kept here,
 * all optional except CrawlRate, since only the REST wire format is load-
 * bearing for this app and the sample is the more concrete source of truth.
 */

export interface BingCrawlStats {
  date: string | null
  allOtherCodes: number
  blockedByRobotsTxt: number
  code2xx: number
  code301: number
  code302: number
  code4xx: number
  code5xx: number
  containsMalware: number
  crawlErrors: number
  crawledPages: number
  inIndex: number
  inLinks: number
}

export interface BingCrawlIssue {
  url: string
  httpCode: number
  inLinks: number
  /** Raw bitmask — Bing does not publish the flag values for this field in
   *  its current docs (only a worked XML example mapping one value to
   *  "ContainsMalware"), so this is shown as an opaque code rather than a
   *  guessed set of flag names. */
  issuesCode: number
}

export interface BingCrawlSettings {
  /** One entry per hour of the day (24 total), each roughly 1 (slowest) to
   *  10 (fastest) — confirmed shape from Bing's REST sample, exact scale
   *  bounds not published. */
  crawlRate: number[]
  ajaxEnabled: boolean | null
  crawlBoostAvailable: boolean | null
  crawlBoostEnabled: boolean | null
}

interface RawCrawlStats {
  Date: string | null
  AllOtherCodes: number
  BlockedByRobotsTxt: number
  Code2xx: number
  Code301: number
  Code302: number
  Code4xx: number
  Code5xx: number
  ContainsMalware: number
  CrawlErrors: number
  CrawledPages: number
  InIndex: number
  InLinks: number
}

interface RawCrawlIssue {
  Url: string
  HttpCode: number
  InLinks: number
  Issues: number
}

interface RawCrawlSettings {
  CrawlRate: number[]
  AjaxEnabled?: boolean
  CrawlBoostAvailable?: boolean
  CrawlBoostEnabled?: boolean
}

export async function getCrawlStats(apiKey: string, siteUrl: string): Promise<BingCrawlStats[]> {
  const raw = await bingGet<RawCrawlStats[]>("GetCrawlStats", apiKey, { siteUrl })
  return (raw ?? []).map((row) => ({
    date: parseBingDate(row.Date),
    allOtherCodes: row.AllOtherCodes,
    blockedByRobotsTxt: row.BlockedByRobotsTxt,
    code2xx: row.Code2xx,
    code301: row.Code301,
    code302: row.Code302,
    code4xx: row.Code4xx,
    code5xx: row.Code5xx,
    containsMalware: row.ContainsMalware,
    crawlErrors: row.CrawlErrors,
    crawledPages: row.CrawledPages,
    inIndex: row.InIndex,
    inLinks: row.InLinks,
  }))
}

export async function getCrawlIssues(apiKey: string, siteUrl: string): Promise<BingCrawlIssue[]> {
  const raw = await bingGet<RawCrawlIssue[]>("GetCrawlIssues", apiKey, { siteUrl })
  return (raw ?? []).map((row) => ({
    url: row.Url,
    httpCode: row.HttpCode,
    inLinks: row.InLinks,
    issuesCode: row.Issues,
  }))
}

export async function getCrawlSettings(apiKey: string, siteUrl: string): Promise<BingCrawlSettings> {
  const raw = await bingGet<RawCrawlSettings>("GetCrawlSettings", apiKey, { siteUrl })
  return {
    crawlRate: raw?.CrawlRate ?? [],
    ajaxEnabled: raw?.AjaxEnabled ?? null,
    crawlBoostAvailable: raw?.CrawlBoostAvailable ?? null,
    crawlBoostEnabled: raw?.CrawlBoostEnabled ?? null,
  }
}

export async function saveCrawlSettings(
  apiKey: string,
  siteUrl: string,
  settings: { crawlRate: number[] }
): Promise<void> {
  // Only CrawlRate is round-tripped on save — AjaxEnabled/CrawlBoost* are
  // read-only account attributes reflecting what Bing has determined about
  // the site, not something this form sets.
  await bingPost<null>("SaveCrawlSettings", apiKey, {
    siteUrl,
    crawlSettings: { CrawlRate: settings.crawlRate },
  })
}
