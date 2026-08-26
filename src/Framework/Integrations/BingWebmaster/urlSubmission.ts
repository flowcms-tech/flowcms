import "server-only"
import { bingGet, bingPost, parseBingDate, quoteBingString } from "./client"

/** Bing's documented cap for a single SubmitUrlBatch call. */
export const URL_SUBMISSION_BATCH_LIMIT = 500

export interface UrlSubmissionQuota {
  dailyQuota: number
  monthlyQuota: number
}

export async function getUrlSubmissionQuota(apiKey: string, siteUrl: string): Promise<UrlSubmissionQuota> {
  const raw = await bingGet<{ DailyQuota: number; MonthlyQuota: number }>("GetUrlSubmissionQuota", apiKey, {
    siteUrl,
  })
  return { dailyQuota: raw.DailyQuota, monthlyQuota: raw.MonthlyQuota }
}

export interface ContentSubmissionQuota {
  dailyQuota: number
  monthlyQuota: number
}

export async function getContentSubmissionQuota(
  apiKey: string,
  siteUrl: string
): Promise<ContentSubmissionQuota> {
  const raw = await bingGet<{ DailyQuota: number; MonthlyQuota: number }>("GetContentSubmissionQuota", apiKey, {
    siteUrl,
  })
  return { dailyQuota: raw.DailyQuota, monthlyQuota: raw.MonthlyQuota }
}

export interface FetchedUrl {
  url: string
  date: string | null
  /** Whether Bingbot has completed the fetch yet — false right after a
   *  FetchUrl call, true once a result is available via
   *  getFetchedUrlDetails. */
  fetched: boolean
  /** True once the fetched result has aged out and is no longer available
   *  in full via getFetchedUrlDetails. */
  expired: boolean
}

export async function getFetchedUrls(apiKey: string, siteUrl: string): Promise<FetchedUrl[]> {
  const raw = await bingGet<Array<{ Url: string; Date: string | null; Fetched: boolean; Expired: boolean }>>(
    "GetFetchedUrls",
    apiKey,
    { siteUrl }
  )
  return (raw ?? []).map((row) => ({
    url: row.Url,
    date: parseBingDate(row.Date),
    fetched: row.Fetched,
    expired: row.Expired,
  }))
}

export interface FetchedUrlDetails {
  url: string
  date: string | null
  /** The raw HTTP status line/headers Bingbot received (Bing does not
   *  document a stricter shape than "string" for this field). */
  status: string | null
  headers: string | null
  /** The fetched document body, as Bing returns it — not decoded/parsed
   *  further here, since Bing's own docs don't specify an encoding beyond
   *  what SubmitContent's httpMessage uses (base64) for the *inbound*
   *  side; this is the *outbound* (what Bing saw) side and its exact
   *  encoding is unconfirmed — render as preformatted text, don't assume
   *  base64 without verifying against a real response. */
  document: string | null
}

export async function getFetchedUrlDetails(
  apiKey: string,
  siteUrl: string,
  url: string
): Promise<FetchedUrlDetails> {
  const raw = await bingGet<{ Url: string; Date: string | null; Status: string | null; Headers: string | null; Document: string | null }>(
    "GetFetchedUrlDetails",
    apiKey,
    { siteUrl, url: quoteBingString(url) }
  )
  return {
    url: raw.Url,
    date: parseBingDate(raw.Date),
    status: raw.Status,
    headers: raw.Headers,
    document: raw.Document,
  }
}

export async function submitUrl(apiKey: string, siteUrl: string, url: string): Promise<void> {
  await bingPost<null>("SubmitUrl", apiKey, { siteUrl, url })
}

export async function submitUrlBatch(apiKey: string, siteUrl: string, urlList: string[]): Promise<void> {
  if (urlList.length === 0) throw new Error("Provide at least one URL to submit.")
  if (urlList.length > URL_SUBMISSION_BATCH_LIMIT) {
    throw new Error(`A batch submission is limited to ${URL_SUBMISSION_BATCH_LIMIT} URLs at a time.`)
  }
  await bingPost<null>("SubmitUrlbatch", apiKey, { siteUrl, urlList })
}

/** dynamicServing: the numeric device-variant code SubmitContent expects —
 *  0 unless the URL genuinely serves different content per device. */
export const DYNAMIC_SERVING = {
  none: 0,
  pcLaptop: 1,
  mobile: 2,
  amp: 3,
  tablet: 4,
  nonVisualBrowser: 5,
} as const

export type DynamicServing = (typeof DYNAMIC_SERVING)[keyof typeof DYNAMIC_SERVING]

export interface SubmitContentInput {
  url: string
  /** Base64-encoded raw HTTP response (status line + headers + blank line +
   *  body) exactly as Bingbot would have received it fetching `url` — per
   *  Bing's own docs, every line must end \r\n. Callers are responsible for
   *  building this; this function does not construct it for them. */
  httpMessage: string
  /** Base64-encoded structured data (typically JSON-LD), or "" if none —
   *  used for non-HTML content types (images, PDFs) that can't carry their
   *  own JSON-LD. */
  structuredData: string
  dynamicServing: DynamicServing
}

export async function submitContent(apiKey: string, siteUrl: string, input: SubmitContentInput): Promise<void> {
  await bingPost<null>("SubmitContent", apiKey, {
    siteUrl,
    url: input.url,
    httpMessage: input.httpMessage,
    structuredData: input.structuredData,
    dynamicServing: input.dynamicServing,
  })
}

/**
 * Fire-and-forget, per Bing's own signature (`void FetchUrl(siteUrl, url)`,
 * same POST-returns-null shape as SubmitUrl) — there is no synchronous
 * result. The fetched content becomes available afterward via
 * getFetchedUrls/getFetchedUrlDetails once Bingbot completes the crawl.
 */
export async function fetchUrl(apiKey: string, siteUrl: string, url: string): Promise<void> {
  await bingPost<null>("FetchUrl", apiKey, { siteUrl, url })
}
