import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { settings } from "@/db/tables"
import { SETTINGS_SINGLETON_ID } from "@/db/schema/settings"
import { CacheService } from "@/Framework/Redis/CacheService"
import {
  resolveBrandFrom,
  resolveBusinessProfileFrom,
  type ResolvedBrand,
  type ResolvedBusinessProfile,
} from "./businessProfile"

// Re-exported so existing consumers keep importing these from SettingsService,
// which is where every other resolved settings type lives.
export type {
  ResolvedBrand,
  ResolvedBusinessProfile,
  ResolvedOpeningHours,
  ResolvedPostalAddress,
} from "./businessProfile"

const CACHE_KEY = "settings:global"
const CACHE_TTL_SECONDS = 300

export interface ResolvedS3Config {
  endpoint: string | undefined
  region: string | undefined
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export interface ResolvedGscConfig {
  clientId: string
  clientSecret: string
  refreshToken: string | null
  siteUrl: string | null
}

export interface ResolvedPageSpeedConfig {
  apiKey: string | null
}

export interface ResolvedBingConfig {
  apiKey: string | null
  siteUrl: string | null
}

type SettingsRow = typeof settings.$inferSelect

async function readRow(): Promise<SettingsRow | null> {
  const cached = await CacheService.getJson<SettingsRow>(CACHE_KEY)
  if (cached) return cached

  const row = (await db.query.settings.findFirst({ where: eq(settings.id, SETTINGS_SINGLETON_ID) })) ?? null
  if (row) await CacheService.setJson(CACHE_KEY, row, CACHE_TTL_SECONDS)
  return row
}

/** Call after any write to the settings row — the row itself is the only
 *  thing cached, so one key covers every resolver below. */
export async function invalidateSettingsCache(): Promise<void> {
  await CacheService.del(CACHE_KEY)
}

/** The raw row, or null if nothing has ever been saved — used by the admin
 *  GET route, which needs to distinguish "never configured" (show env
 *  fallbacks as placeholders) from "explicitly set." Every other consumer
 *  in the app wants a resolved value and should use the functions below
 *  instead. */
export async function getSettingsRow(): Promise<SettingsRow | null> {
  return readRow()
}

export async function getBaseUrl(): Promise<string> {
  const row = await readRow()
  const url = row?.baseUrl || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"
  return url.replace(/\/$/, "")
}

export async function getBrand(): Promise<ResolvedBrand> {
  const row = await readRow()
  return resolveBrandFrom(row)
}

/**
 * Merges the settings row over env vars, field by field — an admin can
 * override just the bucket name and leave everything else on env-provided
 * credentials, for instance. Throws only if a field is missing from BOTH
 * sources, since an S3 client genuinely cannot be built without it; this
 * mirrors the non-null assertions the original static s3Client.ts used to
 * make at module load, just deferred to call time.
 */
export async function getS3Config(): Promise<ResolvedS3Config> {
  const row = await readRow()

  const bucket = row?.s3Bucket || process.env.S3_BUCKET
  const accessKeyId = row?.s3AccessKeyId || process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = row?.s3SecretAccessKey || process.env.S3_SECRET_ACCESS_KEY

  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3 is not configured — set it in Admin > Settings > Global, or via S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY."
    )
  }

  return {
    endpoint: row?.s3Endpoint || process.env.S3_ENDPOINT || undefined,
    region: row?.s3Region || process.env.S3_REGION || undefined,
    bucket,
    accessKeyId,
    secretAccessKey,
  }
}

/**
 * No env-var fallback here, unlike S3 — this integration didn't exist before
 * the admin panel could store secrets itself, so there's no legacy
 * GSC_CLIENT_ID/GSC_CLIENT_SECRET to fall back to. The OAuth client and
 * refresh token live in the settings row or nowhere.
 */
export async function getGscConfig(): Promise<ResolvedGscConfig> {
  const row = await readRow()
  return {
    clientId: row?.gscClientId || "",
    clientSecret: row?.gscClientSecret || "",
    refreshToken: row?.gscRefreshToken || null,
    siteUrl: row?.gscSiteUrl || null,
  }
}

/** Same "no env-var fallback" reasoning as getGscConfig — PageSpeed Insights
 *  is a plain API key, not OAuth, but it's stored (and never returned by
 *  GET) exactly the same way. */
export async function getPageSpeedConfig(): Promise<ResolvedPageSpeedConfig> {
  const row = await readRow()
  return { apiKey: row?.pagespeedApiKey || null }
}

/** Same "no env-var fallback, never returned by GET" treatment as
 *  getPageSpeedConfig — Bing Webmaster Tools authenticates with a plain API
 *  key, not OAuth. `siteUrl` is a site *picker* value resolved against
 *  GetUserSites for the configured key, not a credential of its own. */
export async function getBingConfig(): Promise<ResolvedBingConfig> {
  const row = await readRow()
  return { apiKey: row?.bingApiKey || null, siteUrl: row?.bingSiteUrl || null }
}

/** The exact URI to register as an "Authorized redirect URI" on the OAuth
 *  client in Google Cloud Console — must match byte-for-byte what the auth
 *  route sends, or Google rejects the exchange with redirect_uri_mismatch. */
export async function getGscRedirectUri(): Promise<string> {
  const baseUrl = await getBaseUrl()
  return `${baseUrl}/api/integrations/google-search-console/callback`
}

// -- Meta templates ----------------------------------------------------------

export interface ResolvedMetaTemplates {
  /** Applied when a post leaves metaTitle blank. Per-post values always win. */
  postTitle: string
  postDescription: string
  categoryTitle: string
  tagTitle: string
  authorTitle: string
  /** The %sep% variable. */
  separator: string
}

/** The template shape every archive type falls back to, and the post default.
 *  Stated once so a blank category template behaves identically to a blank
 *  post template instead of quietly emitting a bare title. */
const DEFAULT_TITLE_TEMPLATE = "%title% %sep% %sitename%"

export async function getMetaTemplates(): Promise<ResolvedMetaTemplates> {
  const row = await readRow()
  return {
    postTitle: row?.metaTitleTemplate || DEFAULT_TITLE_TEMPLATE,
    // Not "%excerpt% %sep% %sitename%": a description is prose read by a human
    // in the SERP, and appending the site name to it wastes characters that
    // Google truncates anyway.
    postDescription: row?.metaDescriptionTemplate || "%excerpt%",
    categoryTitle: row?.categoryTitleTemplate || DEFAULT_TITLE_TEMPLATE,
    tagTitle: row?.tagTitleTemplate || DEFAULT_TITLE_TEMPLATE,
    authorTitle: row?.authorTitleTemplate || DEFAULT_TITLE_TEMPLATE,
    separator: row?.titleSeparator || "|",
  }
}

// -- Link handling -----------------------------------------------------------

export interface ResolvedLinkPolicy {
  /** rel applied to external links when post content is sanitized on write. */
  rel: string
  newTab: boolean
}

export async function getLinkPolicy(): Promise<ResolvedLinkPolicy> {
  const row = await readRow()
  return {
    rel: row?.externalLinkRel || "nofollow noopener",
    // notNull with a default of true in the schema, so `??` only fires when
    // there is no settings row at all.
    newTab: row?.externalLinkNewTab ?? true,
  }
}

// -- Indexing ----------------------------------------------------------------

export interface ResolvedIndexingConfig {
  /** Null until generated. IndexNow submissions are impossible without it, so
   *  `indexNowEnabled` alone is not sufficient to fire one — check both. */
  indexNowKey: string | null
  indexNowEnabled: boolean
  googleIndexingApiEnabled: boolean
  newsSitemapEnabled: boolean
  /** Raw text, one directive per line. Parse with `parseRobotsRules` from
   *  `@/Modules/Settings/Values/robotsRules` — kept unparsed here so the
   *  parser stays in one place shared by the route, the admin preview, and
   *  the validation schema. */
  robotsExtraRules: string
  robotsExtraSitemaps: string
}

export async function getIndexingConfig(): Promise<ResolvedIndexingConfig> {
  const row = await readRow()
  return {
    indexNowKey: row?.indexNowKey || null,
    indexNowEnabled: row?.indexNowEnabled ?? false,
    // Both default OFF, and the UI explains why rather than only this file:
    // Google's Indexing API is documented for JobPosting and BroadcastEvent
    // only, and a news sitemap does nothing without publisher approval.
    googleIndexingApiEnabled: row?.googleIndexingApiEnabled ?? false,
    newsSitemapEnabled: row?.newsSitemapEnabled ?? false,
    robotsExtraRules: row?.robotsExtraRules || "",
    robotsExtraSitemaps: row?.robotsExtraSitemaps || "",
  }
}
// -- Business profile / NAP --------------------------------------------------

/**
 * LocalBusiness / NAP data for structured markup.
 *
 * The resolution rules live in `businessProfile.ts` as pure functions; this is
 * only the database read. They used to fall back to a customer-specific config
 * file under `src/Modules/Public/`, which both inverted the layering (Framework
 * depending on Modules) and hardcoded one real business address and two real
 * phone numbers into software everyone installs.
 *
 * Now: unset means unset. See `businessProfile.ts` for why that matters more
 * here than in most settings.
 */
export async function getBusinessProfile(): Promise<ResolvedBusinessProfile> {
  return resolveBusinessProfileFrom(await readRow())
}
