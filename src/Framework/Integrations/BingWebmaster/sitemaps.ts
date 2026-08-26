import "server-only"
import { bingGet, bingPost, parseBingDate, quoteBingString } from "./client"

/**
 * Sitemaps ("Feeds" in Bing's own naming) — GetFeeds, GetFeedDetails,
 * SubmitFeed, RemoveFeed. Field names confirmed against Microsoft Learn's
 * REST samples for each method. `feedUrl` is a String GET param on
 * GetFeedDetails and is quoted via `quoteBingString` (confirmed pattern —
 * see `client.ts`); Submit/RemoveFeed are POST with a JSON body, which
 * needs no manual quoting.
 */

export type BingFeedStatus = string

export interface BingFeed {
  url: string
  type: string
  status: BingFeedStatus
  urlCount: number
  fileSize: number
  compressed: boolean
  /** ISO date, or null if never crawled/submitted. */
  lastCrawled: string | null
  submitted: string | null
}

interface RawFeed {
  Url: string
  Type: string
  Status: string
  UrlCount: number
  FileSize: number
  Compressed: boolean
  LastCrawled: string | null
  Submitted: string | null
}

function toFeed(raw: RawFeed): BingFeed {
  return {
    url: raw.Url,
    type: raw.Type,
    status: raw.Status,
    urlCount: raw.UrlCount,
    fileSize: raw.FileSize,
    compressed: raw.Compressed,
    lastCrawled: parseBingDate(raw.LastCrawled),
    submitted: parseBingDate(raw.Submitted),
  }
}

export async function getFeeds(apiKey: string, siteUrl: string): Promise<BingFeed[]> {
  const raw = await bingGet<RawFeed[]>("GetFeeds", apiKey, { siteUrl })
  return (raw ?? []).map(toFeed)
}

/** Only meaningful for a sitemap *index* — expands it into the child feeds
 *  Bing has discovered underneath it. */
export async function getFeedDetails(apiKey: string, siteUrl: string, feedUrl: string): Promise<BingFeed[]> {
  const raw = await bingGet<RawFeed[]>("GetFeedDetails", apiKey, { siteUrl, feedUrl: quoteBingString(feedUrl) })
  return (raw ?? []).map(toFeed)
}

/** Supported formats per Bing's docs: Sitemap, RSS 2.0, Atom 0.3, Atom 1.0,
 *  and plain text files. Void on success. */
export async function submitFeed(apiKey: string, siteUrl: string, feedUrl: string): Promise<void> {
  await bingPost<null>("SubmitFeed", apiKey, { siteUrl, feedUrl })
}

export async function removeFeed(apiKey: string, siteUrl: string, feedUrl: string): Promise<void> {
  await bingPost<null>("RemoveFeed", apiKey, { siteUrl, feedUrl })
}
