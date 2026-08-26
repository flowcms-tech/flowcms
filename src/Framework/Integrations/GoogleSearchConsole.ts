import "server-only"
import { google } from "googleapis"

/**
 * Read-write, not `webmasters.readonly`.
 *
 * Everything this app reads (site list, Search Analytics) works under the
 * readonly scope. Submitting a sitemap does not — and submitting one is the
 * supported replacement for the sitemap ping endpoints Google retired in 2023,
 * so it is the only way left to tell Google a sitemap changed.
 *
 * The cost is real and is handled rather than hidden: an account connected
 * under the old readonly scope keeps working for reads and fails only on
 * submit. `refreshTokenHasScope` below detects that, and the Integrations panel
 * prompts a reconnect instead of letting every publish fail silently.
 */
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters"

/** What consent used to request. Kept so an existing token can be recognised
 *  as "connected, but too narrow to submit" rather than simply broken. */
export const GSC_READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"

export interface GscOAuthCredentials {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export function buildOAuthClient({ clientId, clientSecret, redirectUri }: GscOAuthCredentials) {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

/**
 * access_type=offline + prompt=consent are both required to get a
 * refresh_token back on every connect — without prompt=consent, Google only
 * issues one the very first time an account ever authorizes this client,
 * silently omitting it on every reconnect after that.
 */
export function buildAuthUrl(credentials: GscOAuthCredentials, state: string): string {
  const client = buildOAuthClient(credentials)
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GSC_SCOPE],
    state,
  })
}

export async function exchangeCodeForRefreshToken(
  credentials: GscOAuthCredentials,
  code: string
): Promise<string> {
  const client = buildOAuthClient(credentials)
  const { tokens } = await client.getToken(code)
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke this app's access at https://myaccount.google.com/permissions and try connecting again."
    )
  }
  return tokens.refresh_token
}

export interface GscSite {
  siteUrl: string
  permissionLevel: string
}

/**
 * Verifies a stored refresh token still works and reports every verified
 * property the connected account can see — the same call backs both the
 * "Check Connection" button and the site picker.
 */
export async function listSites(
  credentials: GscOAuthCredentials,
  refreshToken: string
): Promise<GscSite[]> {
  const client = buildOAuthClient(credentials)
  client.setCredentials({ refresh_token: refreshToken })

  const searchconsole = google.searchconsole({ version: "v1", auth: client })
  const res = await searchconsole.sites.list()
  return (res.data.siteEntry ?? []).map((entry) => ({
    siteUrl: entry.siteUrl ?? "",
    permissionLevel: entry.permissionLevel ?? "unknown",
  }))
}

// -- URL Inspection -----------------------------------------------------------

export interface GscUrlInspection {
  inspectionUrl: string
  /** "PASS" means Google considers the URL indexed/indexable; anything else
   *  (FAIL/NEUTRAL/PARTIAL/null) is the "not indexed" half. This is the same
   *  field the coverage counts are derived from — a single source of truth
   *  for "indexed or not" rather than pattern-matching `coverageState`. */
  verdict: string | null
  /** Google's own reason string — "Crawled - currently not indexed",
   *  "Duplicate without user-selected canonical", "Submitted and indexed",
   *  etc. Exactly the vocabulary the Search Console UI's coverage report
   *  uses, since it comes from the same underlying field. */
  coverageState: string | null
  robotsTxtState: string | null
  indexingState: string | null
  pageFetchState: string | null
  crawledAs: string | null
  lastCrawlTime: string | null
  googleCanonical: string | null
  userCanonical: string | null
  sitemaps: string[]
  referringUrls: string[]
  mobileUsabilityVerdict: string | null
  mobileUsabilityIssueCount: number
  richResultsVerdict: string | null
  richResultsTypeCount: number
  /** One entry per detected rich-result type (FAQPage, Product, …), with how
   *  many of its items are clean vs. have at least one ERROR-severity issue.
   *  WARNING-only items still count as valid — only ERROR blocks the rich
   *  result from appearing in Search. */
  richResultTypes: GscRichResultType[]
  /** Deep link into the real Search Console UI for this exact URL — the
   *  escape hatch to Google's own richer (but API-inaccessible) detail view. */
  inspectionResultLink: string | null
}

export interface GscRichResultType {
  type: string
  validCount: number
  invalidCount: number
}

/**
 * Live per-URL diagnostic — the one indexing-related endpoint Google
 * actually exposes via API. No bulk/historical equivalent exists: the
 * Index Coverage report's counts and time series are Search-Console-UI-only.
 *
 * Costs one call against the property's URL Inspection quota (2,000/day by
 * default) per invocation — callers should cache the result rather than
 * re-inspecting on every page view.
 */
export async function inspectUrl(
  credentials: GscOAuthCredentials,
  refreshToken: string,
  siteUrl: string,
  inspectionUrl: string
): Promise<GscUrlInspection> {
  const client = buildOAuthClient(credentials)
  client.setCredentials({ refresh_token: refreshToken })

  const searchconsole = google.searchconsole({ version: "v1", auth: client })
  const res = await searchconsole.urlInspection.index.inspect({
    requestBody: { inspectionUrl, siteUrl },
  })

  const result = res.data.inspectionResult
  const idx = result?.indexStatusResult

  const richResultTypes: GscRichResultType[] = (result?.richResultsResult?.detectedItems ?? []).map(
    (detected) => {
      const items = detected.items ?? []
      const invalidCount = items.filter((item) =>
        (item.issues ?? []).some((issue) => issue.severity === "ERROR")
      ).length
      return {
        type: detected.richResultType ?? "Unknown",
        validCount: items.length - invalidCount,
        invalidCount,
      }
    }
  )

  return {
    inspectionUrl,
    verdict: idx?.verdict ?? null,
    coverageState: idx?.coverageState ?? null,
    robotsTxtState: idx?.robotsTxtState ?? null,
    indexingState: idx?.indexingState ?? null,
    pageFetchState: idx?.pageFetchState ?? null,
    crawledAs: idx?.crawledAs ?? null,
    lastCrawlTime: idx?.lastCrawlTime ?? null,
    googleCanonical: idx?.googleCanonical ?? null,
    userCanonical: idx?.userCanonical ?? null,
    sitemaps: idx?.sitemap ?? [],
    referringUrls: idx?.referringUrls ?? [],
    mobileUsabilityVerdict: result?.mobileUsabilityResult?.verdict ?? null,
    mobileUsabilityIssueCount: result?.mobileUsabilityResult?.issues?.length ?? 0,
    richResultsVerdict: result?.richResultsResult?.verdict ?? null,
    richResultsTypeCount: result?.richResultsResult?.detectedItems?.length ?? 0,
    richResultTypes,
    inspectionResultLink: result?.inspectionResultLink ?? null,
  }
}

// -- Search Analytics --------------------------------------------------------

/**
 * Search Analytics is a read operation, so everything below works under the
 * narrower `webmasters.readonly` too. That matters for accounts connected
 * before the scope widened: the per-post Insights panel keeps working on them
 * with no re-consent, and only sitemap submission needs the reconnect.
 */

export interface GscSearchAnalyticsRequest {
  /** YYYY-MM-DD, in the property's own timezone (GSC uses America/Los_Angeles). */
  startDate: string
  endDate: string
  /** e.g. `["date"]`, `["query"]`. Omit for a single totals row. */
  dimensions?: string[]
  /** Restricts the whole query to one page. Passed as an exact-match `page`
   *  filter rather than a `page` dimension + client-side filter, because the
   *  latter would pull the entire property's rows to find one page's. */
  pageUrl?: string
  rowLimit?: number
}

export interface GscAnalyticsRow {
  /** One entry per requested dimension, in the order they were requested. */
  keys: string[]
  clicks: number
  impressions: number
  /** 0–1, as Google returns it. Formatting to a percentage is the UI's job. */
  ctr: number
  /** 1-based average position, impression-weighted by Google. */
  position: number
}

export async function querySearchAnalytics(
  credentials: GscOAuthCredentials,
  refreshToken: string,
  siteUrl: string,
  request: GscSearchAnalyticsRequest
): Promise<GscAnalyticsRow[]> {
  const client = buildOAuthClient(credentials)
  client.setCredentials({ refresh_token: refreshToken })

  const searchconsole = google.searchconsole({ version: "v1", auth: client })
  const res = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: request.startDate,
      endDate: request.endDate,
      dimensions: request.dimensions,
      rowLimit: request.rowLimit ?? 1000,
      dimensionFilterGroups: request.pageUrl
        ? [{ filters: [{ dimension: "page", operator: "equals", expression: request.pageUrl }] }]
        : undefined,
      // "web" only. Bundling Image and News into the same numbers makes the
      // position average unreadable — an article ranking #2 on web and #40 in
      // Images averages to something that describes neither.
      type: "web",
    },
  })

  return (res.data.rows ?? []).map((row) => ({
    keys: row.keys ?? [],
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }))
}

/**
 * Tell Google a sitemap changed.
 *
 * This is the supported replacement for `google.com/ping?sitemap=`, which was
 * retired in June 2023 (Bing's went the same way). Anything still recommending
 * that endpoint is out of date — do not add it back.
 *
 * Called from `PublishHooks` and deliberately never allowed to fail a publish:
 * it throws here, and the caller swallows it behind a timeout.
 *
 * Requires the read-write `GSC_SCOPE`. An account connected under the old
 * readonly scope gets a 403 here, which is what `refreshTokenHasScope` exists
 * to pre-empt.
 */
export async function submitSitemap(sitemapUrl: string): Promise<void> {
  const { getGscConfig, getGscRedirectUri } = await import("@/Framework/Settings/SettingsService")
  const config = await getGscConfig()
  if (!config.clientId || !config.clientSecret || !config.refreshToken || !config.siteUrl) return

  const client = buildOAuthClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: await getGscRedirectUri(),
  })
  client.setCredentials({ refresh_token: config.refreshToken })

  const searchconsole = google.searchconsole({ version: "v1", auth: client })
  await searchconsole.sitemaps.submit({ siteUrl: config.siteUrl, feedpath: sitemapUrl })
}

export interface GscSitemap extends Record<string, unknown> {
  path: string
  type: string | null
  isSitemapsIndex: boolean
  isPending: boolean
  lastSubmitted: string | null
  lastDownloaded: string | null
  errorCount: number
  warningCount: number
  /** Summed `submitted` count across every content entry — a sitemap index's
   *  own contents[] describes child sitemaps, not URLs, so this is 0 for one. */
  urlCount: number
}

function toGscSitemap(entry: {
  path?: string | null
  type?: string | null
  isSitemapsIndex?: boolean | null
  isPending?: boolean | null
  lastSubmitted?: string | null
  lastDownloaded?: string | null
  errors?: string | null
  warnings?: string | null
  contents?: { submitted?: string | null }[] | null
}): GscSitemap {
  return {
    path: entry.path ?? "",
    type: entry.type ?? null,
    isSitemapsIndex: entry.isSitemapsIndex ?? false,
    isPending: entry.isPending ?? false,
    lastSubmitted: entry.lastSubmitted ?? null,
    lastDownloaded: entry.lastDownloaded ?? null,
    // Google returns these as decimal strings, not numbers.
    errorCount: entry.errors ? Number(entry.errors) : 0,
    warningCount: entry.warnings ? Number(entry.warnings) : 0,
    urlCount: (entry.contents ?? []).reduce((sum, c) => sum + (c.submitted ? Number(c.submitted) : 0), 0),
  }
}

/** Every sitemap currently submitted for the property. Read-only, so this
 *  works under `webmasters.readonly` — no reconnect needed for accounts
 *  connected before submit/delete required the wider scope. */
export async function listSitemaps(
  credentials: GscOAuthCredentials,
  refreshToken: string,
  siteUrl: string
): Promise<GscSitemap[]> {
  const client = buildOAuthClient(credentials)
  client.setCredentials({ refresh_token: refreshToken })

  const searchconsole = google.searchconsole({ version: "v1", auth: client })
  const res = await searchconsole.sitemaps.list({ siteUrl })
  return (res.data.sitemap ?? []).map(toGscSitemap)
}

/** Explicit-params sibling of `submitSitemap` below — used by the Sitemaps
 *  admin screen, which already has credentials/siteUrl from the caller and
 *  a specific feedpath the admin typed, rather than the always-the-same
 *  sitemap index PublishHooks submits after every publish. */
export async function submitSitemapPath(
  credentials: GscOAuthCredentials,
  refreshToken: string,
  siteUrl: string,
  feedpath: string
): Promise<void> {
  const client = buildOAuthClient(credentials)
  client.setCredentials({ refresh_token: refreshToken })

  const searchconsole = google.searchconsole({ version: "v1", auth: client })
  await searchconsole.sitemaps.submit({ siteUrl, feedpath })
}

export async function deleteSitemap(
  credentials: GscOAuthCredentials,
  refreshToken: string,
  siteUrl: string,
  feedpath: string
): Promise<void> {
  const client = buildOAuthClient(credentials)
  client.setCredentials({ refresh_token: refreshToken })

  const searchconsole = google.searchconsole({ version: "v1", auth: client })
  await searchconsole.sitemaps.delete({ siteUrl, feedpath })
}

/**
 * Whether a stored refresh token was granted the scope we now need.
 *
 * Google returns the granted scopes when a refresh token is exchanged for an
 * access token, so this costs one token refresh and no user-visible step. The
 * Integrations panel uses it to show "reconnect to enable sitemap submission"
 * rather than leaving the owner to discover the gap through publishes that
 * quietly do nothing.
 *
 * Returns false on any failure — an unknown scope is treated as insufficient,
 * because the failure mode of guessing "yes" is a silent no-op forever.
 */
export async function refreshTokenHasScope(
  credentials: GscOAuthCredentials,
  refreshToken: string,
  scope: string = GSC_SCOPE
): Promise<boolean> {
  try {
    const client = buildOAuthClient(credentials)
    client.setCredentials({ refresh_token: refreshToken })
    const { token } = await client.getAccessToken()
    if (!token) return false

    const info = await client.getTokenInfo(token)
    return (info.scopes ?? []).includes(scope)
  } catch {
    return false
  }
}
