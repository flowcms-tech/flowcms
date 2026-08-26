import "server-only"
import { bingGet, bingPost, parseBingDate } from "./client"

/**
 * The 7 minor-configuration resources bundled under the Site Settings
 * screen. Field names below are confirmed against each method's REST
 * sample on Microsoft Learn where one exists; a few (DeepLinkBlock's GET
 * shape, PagePreview's BlockReason enum, QueryParameter.Source's meaning)
 * have no published sample response — those are marked inline and should
 * be re-verified against a live account's actual response before this UI
 * is trusted for anything beyond "does the call succeed."
 */

// -- Blocked URLs --------------------------------------------------------

/** Confirmed via cross-referencing AddBlockedUrl's XML+JSON samples of the
 *  SAME request: XML EntityType=Page ↔ JSON EntityType=0, XML
 *  RequestType=FullRemoval ↔ JSON RequestType=1; RemoveBlockedUrl's sample
 *  pairs EntityType=Directory↔1 and RequestType=CacheOnly↔0. */
export const BLOCKED_URL_ENTITY_TYPE = { page: 0, directory: 1 } as const
export const BLOCKED_URL_REQUEST_TYPE = { cacheOnly: 0, fullRemoval: 1 } as const

export interface BlockedUrl {
  date: string | null
  entityType: number
  requestType: number
  url: string
}

interface BingBlockedUrl {
  Date: string | null
  EntityType: number
  RequestType: number
  Url: string
}

function toBlockedUrl(raw: BingBlockedUrl): BlockedUrl {
  return { date: parseBingDate(raw.Date), entityType: raw.EntityType, requestType: raw.RequestType, url: raw.Url }
}

export async function getBlockedUrls(apiKey: string, siteUrl: string): Promise<BlockedUrl[]> {
  const raw = await bingGet<BingBlockedUrl[]>("GetBlockedUrls", apiKey, { siteUrl })
  return (raw ?? []).map(toBlockedUrl)
}

export async function addBlockedUrl(
  apiKey: string,
  siteUrl: string,
  input: { url: string; entityType: number; requestType: number }
): Promise<void> {
  await bingPost("AddBlockedUrl", apiKey, {
    siteUrl,
    blockedUrl: {
      __type: "BlockedUrl:#Microsoft.Bing.Webmaster.Api",
      Date: "/Date(0)/",
      EntityType: input.entityType,
      RequestType: input.requestType,
      Url: input.url,
    },
  })
}

export async function removeBlockedUrl(
  apiKey: string,
  siteUrl: string,
  input: { url: string; entityType: number; requestType: number }
): Promise<void> {
  await bingPost("RemoveBlockedUrl", apiKey, {
    siteUrl,
    blockedUrl: {
      __type: "BlockedUrl:#Microsoft.Bing.Webmaster.Api",
      Date: "/Date(0)/",
      EntityType: input.entityType,
      RequestType: input.requestType,
      Url: input.url,
    },
  })
}

// -- Query (URL normalization) parameters --------------------------------

export interface QueryParameter {
  date: string | null
  isEnabled: boolean
  parameter: string
  /** Confirmed present (every sample row has it) but its meaning is not
   *  documented anywhere in Bing's reference — every real sample shows
   *  `1`. Surfaced as a raw number rather than guessed at. */
  source: number
}

interface BingQueryParameter {
  Date: string | null
  IsEnabled: boolean
  Parameter: string
  Source: number
}

export async function getQueryParameters(apiKey: string, siteUrl: string): Promise<QueryParameter[]> {
  const raw = await bingGet<BingQueryParameter[]>("GetQueryParameters", apiKey, { siteUrl })
  return (raw ?? []).map((p) => ({ date: parseBingDate(p.Date), isEnabled: p.IsEnabled, parameter: p.Parameter, source: p.Source }))
}

/** Bing's own constraint (documented on AddQueryParameter/RemoveQueryParameter):
 *  "may contain only unreserved letters and colon symbol (:)". */
export async function addQueryParameter(apiKey: string, siteUrl: string, queryParameter: string): Promise<void> {
  await bingPost("AddQueryParameter", apiKey, { siteUrl, queryParameter })
}

export async function removeQueryParameter(apiKey: string, siteUrl: string, queryParameter: string): Promise<void> {
  await bingPost("RemoveQueryParameter", apiKey, { siteUrl, queryParameter })
}

export async function enableDisableQueryParameter(
  apiKey: string,
  siteUrl: string,
  queryParameter: string,
  isEnabled: boolean
): Promise<void> {
  await bingPost("EnableDisableQueryParameter", apiKey, { siteUrl, queryParameter, isEnabled })
}

// -- Country/region (geo-targeting) settings -----------------------------

export interface CountryRegionSetting {
  date: string | null
  twoLetterIsoCountryCode: string
  /** Confirmed field name (`Type`) but not its possible values — no
   *  published sample response exists for GetCountryRegionSettings. */
  type: number
  url: string
}

interface BingCountryRegionSettings {
  Date: string | null
  TwoLetterIsoCountryCode: string
  Type: number
  Url: string
}

export async function getCountryRegionSettings(apiKey: string, siteUrl: string): Promise<CountryRegionSetting[]> {
  const raw = await bingGet<BingCountryRegionSettings[]>("GetCountryRegionSettings", apiKey, { siteUrl })
  return (raw ?? []).map((s) => ({
    date: parseBingDate(s.Date),
    twoLetterIsoCountryCode: s.TwoLetterIsoCountryCode,
    type: s.Type,
    url: s.Url,
  }))
}

export async function addCountryRegionSettings(
  apiKey: string,
  siteUrl: string,
  input: { twoLetterIsoCountryCode: string; type: number; url: string }
): Promise<void> {
  await bingPost("AddCountryRegionSettings", apiKey, {
    siteUrl,
    settings: {
      __type: "CountryRegionSettings:#Microsoft.Bing.Webmaster.Api",
      Date: "/Date(0)/",
      TwoLetterIsoCountryCode: input.twoLetterIsoCountryCode,
      Type: input.type,
      Url: input.url,
    },
  })
}

export async function removeCountryRegionSettings(
  apiKey: string,
  siteUrl: string,
  input: { twoLetterIsoCountryCode: string; type: number; url: string }
): Promise<void> {
  await bingPost("RemoveCountryRegionSettings", apiKey, {
    siteUrl,
    settings: {
      __type: "CountryRegionSettings:#Microsoft.Bing.Webmaster.Api",
      Date: "/Date(0)/",
      TwoLetterIsoCountryCode: input.twoLetterIsoCountryCode,
      Type: input.type,
      Url: input.url,
    },
  })
}

// -- Deep link blocks ------------------------------------------------------

/** GetDeepLinkBlocks has no published sample response — field names below
 *  (Market/SearchUrl/DeepLinkUrl) are inferred from Add/RemoveDeepLinkBlock's
 *  confirmed flat parameter names, NOT confirmed from an actual response.
 *  Verify against a live account before shipping this to real users. */
export interface DeepLinkBlock {
  date: string | null
  market: string
  searchUrl: string
  deepLinkUrl: string
}

interface BingDeepLinkBlock {
  Date?: string | null
  Market: string
  SearchUrl: string
  DeepLinkUrl: string
}

export async function getDeepLinkBlocks(apiKey: string, siteUrl: string): Promise<DeepLinkBlock[]> {
  const raw = await bingGet<BingDeepLinkBlock[]>("GetDeepLinkBlocks", apiKey, { siteUrl })
  return (raw ?? []).map((b) => ({
    date: parseBingDate(b.Date),
    market: b.Market,
    searchUrl: b.SearchUrl,
    deepLinkUrl: b.DeepLinkUrl,
  }))
}

/** Confirmed: all 4 params are flat top-level JSON fields, not a nested object
 *  (per the .NET signature taking 4 separate strings). */
export async function addDeepLinkBlock(
  apiKey: string,
  siteUrl: string,
  input: { market: string; searchUrl: string; deepLinkUrl: string }
): Promise<void> {
  await bingPost("AddDeepLinkBlock", apiKey, { siteUrl, ...input })
}

export async function removeDeepLinkBlock(
  apiKey: string,
  siteUrl: string,
  input: { market: string; searchUrl: string; deepLinkUrl: string }
): Promise<void> {
  await bingPost("RemoveDeepLinkBlock", apiKey, { siteUrl, ...input })
}

// -- Page preview blocks ---------------------------------------------------

/** BlockReason's possible values are not published anywhere reachable from
 *  Microsoft Learn (the enum's own doc page 404s). Modeled as a free-text
 *  reason field sent as-is — do not assume this is a validated enum on
 *  Bing's side until confirmed with a live call. */
export interface PagePreviewBlock {
  date: string | null
  url: string
  reason: string | null
}

interface BingPagePreview {
  Date?: string | null
  Url: string
  BlockReason?: string | number | null
}

export async function getActivePagePreviewBlocks(apiKey: string, siteUrl: string): Promise<PagePreviewBlock[]> {
  const raw = await bingGet<BingPagePreview[]>("GetActivePagePreviewBlocks", apiKey, { siteUrl })
  return (raw ?? []).map((p) => ({
    date: parseBingDate(p.Date),
    url: p.Url,
    reason: p.BlockReason != null ? String(p.BlockReason) : null,
  }))
}

export async function addPagePreviewBlock(apiKey: string, siteUrl: string, url: string, reason: string): Promise<void> {
  await bingPost("AddPagePreviewBlock", apiKey, { siteUrl, url, reason })
}

export async function removePagePreviewBlock(apiKey: string, siteUrl: string, url: string): Promise<void> {
  await bingPost("RemovePagePreviewBlock", apiKey, { siteUrl, url })
}

// -- Site roles (delegated access) -----------------------------------------

/** Confirmed from GetSiteRoles' sample: `Role:2` pairs with XML `<Role>ReadWrite</Role>`
 *  in the same response — only this one value is confirmed. */
export const SITE_ROLE = { readWrite: 2 } as const

export interface SiteRole {
  date: string | null
  delegatedCode: string
  delegatedCodeOwnerEmail: string
  delegatorEmail: string
  email: string
  expired: boolean
  role: number
  site: string
  verificationSite: string
}

interface BingSiteRoles {
  Date: string | null
  DelegatedCode: string
  DelegatedCodeOwnerEmail: string
  DelegatorEmail: string
  Email: string
  Expired: boolean
  Role: number
  Site: string
  VerificationSite: string
}

function toSiteRole(raw: BingSiteRoles): SiteRole {
  return {
    date: parseBingDate(raw.Date),
    delegatedCode: raw.DelegatedCode,
    delegatedCodeOwnerEmail: raw.DelegatedCodeOwnerEmail,
    delegatorEmail: raw.DelegatorEmail,
    email: raw.Email,
    expired: raw.Expired,
    role: raw.Role,
    site: raw.Site,
    verificationSite: raw.VerificationSite,
  }
}

export async function getSiteRoles(apiKey: string, siteUrl: string, includeAllSubdomains: boolean): Promise<SiteRole[]> {
  const raw = await bingGet<BingSiteRoles[]>("GetSiteRoles", apiKey, {
    siteUrl,
    includeAllSubdomains: String(includeAllSubdomains),
  })
  return (raw ?? []).map(toSiteRole)
}

/** Confirmed: 4 flat string params + 2 flat booleans, not nested. */
export async function addSiteRoles(
  apiKey: string,
  siteUrl: string,
  input: { delegatedUrl: string; userEmail: string; authenticationCode: string; isAdministrator: boolean; isReadOnly: boolean }
): Promise<void> {
  await bingPost("AddSiteRoles", apiKey, { siteUrl, ...input })
}

/** Confirmed: takes the full SiteRoles object back (siteUrl + siteRole),
 *  not just an email — the whole row identifies what to revoke. */
export async function removeSiteRole(apiKey: string, siteUrl: string, role: SiteRole): Promise<void> {
  await bingPost("RemoveSiteRole", apiKey, {
    siteUrl,
    siteRole: {
      __type: "SiteRoles:#Microsoft.Bing.Webmaster.Api",
      Date: "/Date(0)/",
      DelegatedCode: role.delegatedCode,
      DelegatedCodeOwnerEmail: role.delegatedCodeOwnerEmail,
      DelegatorEmail: role.delegatorEmail,
      Email: role.email,
      Expired: role.expired,
      Role: role.role,
      Site: role.site,
      VerificationSite: role.verificationSite,
    },
  })
}

// -- Site moves --------------------------------------------------------------

/** Confirmed field names from the SiteMoveSettings class reference: Date,
 *  MoveScope, MoveType, SourceUrl, TargetUrl. Their enum VALUES are not
 *  published — treated as raw numbers, must be confirmed against a live
 *  account before this form is used for a real, irreversible submission. */
export interface SiteMove {
  date: string | null
  moveScope: number
  moveType: number
  sourceUrl: string
  targetUrl: string
}

interface BingSiteMoveSettings {
  Date: string | null
  MoveScope: number
  MoveType: number
  SourceUrl: string
  TargetUrl: string
}

export async function getSiteMoves(apiKey: string, siteUrl: string): Promise<SiteMove[]> {
  const raw = await bingGet<BingSiteMoveSettings[]>("GetSiteMoves", apiKey, { siteUrl })
  return (raw ?? []).map((m) => ({
    date: parseBingDate(m.Date),
    moveScope: m.MoveScope,
    moveType: m.MoveType,
    sourceUrl: m.SourceUrl,
    targetUrl: m.TargetUrl,
  }))
}

export async function submitSiteMove(
  apiKey: string,
  siteUrl: string,
  input: { moveScope: number; moveType: number; sourceUrl: string; targetUrl: string }
): Promise<void> {
  await bingPost("SubmitSiteMove", apiKey, {
    siteUrl,
    settings: {
      __type: "SiteMoveSettings:#Microsoft.Bing.Webmaster.Api",
      Date: "/Date(0)/",
      MoveScope: input.moveScope,
      MoveType: input.moveType,
      SourceUrl: input.sourceUrl,
      TargetUrl: input.targetUrl,
    },
  })
}
