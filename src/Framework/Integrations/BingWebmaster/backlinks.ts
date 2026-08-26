import "server-only"
import { bingGet, quoteBingString } from "./client"

/**
 * Backlinks: GetLinkCounts, GetUrlLinks, GetConnectedPages.
 *
 * Field names for GetLinkCounts and GetUrlLinks are confirmed from Microsoft
 * Learn's REST/JSON samples. GetUrlLinks' second param is genuinely named
 * `link`, not `url` (confirmed from its own .NET signature and REST
 * sample), and — like every other String GET param in this API — is
 * quoted via `quoteBingString` (sample: `link=%22...%22`). GetConnectedPages
 * has no REST sample published (only a .NET signature returning
 * `List<ConnectedSite>` with no documented field list) — its shape below is
 * a best-effort guess following this API's consistent `Url`-first
 * PascalCase convention, not a confirmed contract. Confirm against a live
 * response before relying on any field other than a bare URL string.
 */

export interface BingLinkCount {
  url: string
  count: number
}

export interface BingLinkCounts {
  links: BingLinkCount[]
  totalPages: number
}

export async function getLinkCounts(apiKey: string, siteUrl: string, page: number): Promise<BingLinkCounts> {
  const raw = await bingGet<{ Links: Array<{ Url: string; Count: number }> | null; TotalPages: number }>(
    "GetLinkCounts",
    apiKey,
    { siteUrl, page: String(page) }
  )
  return {
    links: (raw?.Links ?? []).map((l) => ({ url: l.Url, count: l.Count })),
    totalPages: raw?.TotalPages ?? 0,
  }
}

export interface BingLinkDetail {
  url: string
  anchorText: string
}

export interface BingLinkDetails {
  details: BingLinkDetail[]
  totalPages: number
}

export async function getUrlLinks(
  apiKey: string,
  siteUrl: string,
  link: string,
  page: number
): Promise<BingLinkDetails> {
  const raw = await bingGet<{ Details: Array<{ Url: string; AnchorText: string }> | null; TotalPages: number }>(
    "GetUrlLinks",
    apiKey,
    { siteUrl, link: quoteBingString(link), page: String(page) }
  )
  return {
    details: (raw?.Details ?? []).map((d) => ({ url: d.Url, anchorText: d.AnchorText })),
    totalPages: raw?.TotalPages ?? 0,
  }
}

/** Unconfirmed field shape — see file-level comment. */
export interface BingConnectedPage {
  url: string
}

export async function getConnectedPages(apiKey: string, siteUrl: string): Promise<BingConnectedPage[]> {
  const raw = await bingGet<Array<{ Url?: string; ConnectedPage?: string }> | null>(
    "GetConnectedPages",
    apiKey,
    { siteUrl }
  )
  return (raw ?? [])
    .map((entry) => entry.Url ?? entry.ConnectedPage ?? "")
    .filter(Boolean)
    .map((url) => ({ url }))
}
