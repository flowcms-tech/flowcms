import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db/client"
import { settings } from "@/db/tables"
import { SETTINGS_SINGLETON_ID } from "@/db/schema/settings"
import { mediaPath } from "@/Framework/Storage/mediaUrl"
import {
  getSettingsRow,
  getBrand,
  getBaseUrl,
  getGscRedirectUri,
  invalidateSettingsCache,
} from "@/Framework/Settings/SettingsService"
import { updateSiteSettingsSchema } from "@/Modules/Settings/Values/Validations"
import type { OpeningHoursEntry } from "@/Modules/Settings/Types"
import { canManageSettings, resolveRole } from "@/Framework/Auth/permissions"
import { changedFieldLabels, recordActivity, summariseChanges } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { upsert } from "@/db/writes"
import { rejectTopologyChange } from "@/Framework/Storage/storageTopologyGuard"
import { resolveStorageDriverName, LOCAL_STORAGE_PATH_ENV } from "@/Framework/Storage/storageConfig"
import { getActiveStorageConfig } from "@/Framework/Storage/activeStorage"

/** Settings hold credentials (S3, Google OAuth) and change how the public site
 *  behaves, so they stop at admin. GET is gated as well as PATCH: the response
 *  reveals which secrets are configured and every endpoint the site talks to,
 *  which is not something an editor account needs. */
const SETTINGS_FORBIDDEN = "Only an owner or admin can manage site settings"

/**
 * What the DEPLOYMENT ENVIRONMENT names, or null if `STORAGE_DRIVER` is set to
 * something invalid.
 *
 * A CANDIDATE, NOT THE ANSWER. Since Phase 4 an established installation
 * records which location it actually uses, and the environment only prepares a
 * destination. This is reported so the screen can say "you changed this and it
 * did not take effect"; `storageDriver` below is the fact.
 *
 * Never throws: this settings screen is the one place an operator can look to
 * understand a misconfigured deployment, so it must render even when the
 * configuration it is describing is wrong.
 */
function deploymentStorageDriver(): "s3" | "local" | null {
  try {
    return resolveStorageDriverName()
  } catch {
    return null
  }
}

/**
 * WHERE THE FILES ACTUALLY ARE.
 *
 * Reads the durable active-storage snapshot. Before Phase 5 this response
 * reported `resolveStorageDriverName()` — the environment — which is correct
 * only until an installation migrates. An installation that has moved from S3
 * to Local still has `STORAGE_DRIVER=s3` in its .env, and the one screen an
 * operator opens to find out where their media lives would have confidently
 * named the wrong backend.
 *
 * Null when it cannot be determined, so the screen degrades to the deployment
 * candidate rather than failing to render.
 */
async function activeStorage() {
  try {
    return await getActiveStorageConfig()
  } catch {
    return null
  }
}

/**
 * Reads one of the three JSON columns, returning the default rather than
 * throwing on malformed stored JSON.
 *
 * That choice is load-bearing: this route is the *only* way to fix a bad
 * value, so a settings screen that 500s on its own stored data is
 * unrecoverable from the UI. Degrading to "looks empty, save to replace" is
 * always better than a dead page.
 */
function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

/**
 * The *resolved* (settings-row-over-env-var) value for every field except
 * the S3 secret, which is never sent to the client in any form — only
 * whether one is currently set, from either source. Shared by GET and
 * PATCH's response so a save repopulates the form with exactly what a
 * fresh page load would show, not a hand-assembled echo of the request.
 */
async function serializeSettings() {
  const [row, brand, baseUrl, gscRedirectUri, active] = await Promise.all([
    getSettingsRow(),
    getBrand(),
    getBaseUrl(),
    getGscRedirectUri(),
    activeStorage(),
  ])

  return {
    siteName: brand.siteName,
    tagline: brand.tagline,
    logoKey: brand.logoKey,
    logoAltText: brand.logoAltText,
    logoUrl: brand.logoKey
      ? mediaPath(brand.logoKey)
      : null,
    faviconKey: brand.faviconKey,
    faviconUrl: brand.faviconKey
      ? mediaPath(brand.faviconKey)
      : null,
    baseUrl,
    // WHICH BACKEND IS ACTUALLY RUNNING — the durable snapshot, falling back to
    // the environment only while an installation has not pinned one (a fresh
    // install, or one still being set up). The admin panel reports it and
    // cannot change it: moving an installation between locations is a verified
    // migration, not a form field.
    storageDriver: active ? active.driver : deploymentStorageDriver(),
    // Only meaningful for the local driver, and deliberately read-only: an
    // arbitrary path typed into a browser can point outside the container's
    // persistent volume, and that failure is silent until the next restart.
    localStoragePath:
      active?.driver === "local" ? active.root : process.env[LOCAL_STORAGE_PATH_ENV] || "",
    // What the deployment CONFIGURES, which may differ from the two above after
    // a migration. Reported so the screen can explain an edit that did not take
    // effect; never applied. Null means STORAGE_DRIVER names something that is
    // not a driver.
    deploymentStorageDriver: deploymentStorageDriver(),
    deploymentLocalStoragePath: process.env[LOCAL_STORAGE_PATH_ENV] || "",
    s3Endpoint: row?.s3Endpoint || process.env.S3_ENDPOINT || "",
    s3Region: row?.s3Region || process.env.S3_REGION || "",
    s3Bucket: row?.s3Bucket || process.env.S3_BUCKET || "",
    s3AccessKeyId: row?.s3AccessKeyId || process.env.S3_ACCESS_KEY_ID || "",
    hasS3SecretAccessKey: !!(row?.s3SecretAccessKey || process.env.S3_SECRET_ACCESS_KEY),
    gscClientId: row?.gscClientId || "",
    hasGscClientSecret: !!row?.gscClientSecret,
    hasGscRefreshToken: !!row?.gscRefreshToken,
    gscSiteUrl: row?.gscSiteUrl || "",
    gscRedirectUri,
    hasPagespeedApiKey: !!row?.pagespeedApiKey,
    bingSiteUrl: row?.bingSiteUrl || "",
    hasBingApiKey: !!row?.bingApiKey,

    // Everything below is the RAW stored value, not the resolved one. The
    // forms need to show "not overridden" as a blank field with the default
    // as a placeholder; resolving here would make an unset field
    // indistinguishable from one the owner deliberately typed.
    metaTitleTemplate: row?.metaTitleTemplate || "",
    metaDescriptionTemplate: row?.metaDescriptionTemplate || "",
    categoryTitleTemplate: row?.categoryTitleTemplate || "",
    tagTitleTemplate: row?.tagTitleTemplate || "",
    authorTitleTemplate: row?.authorTitleTemplate || "",
    titleSeparator: row?.titleSeparator || "",

    externalLinkRel: row?.externalLinkRel || "",
    externalLinkNewTab: row?.externalLinkNewTab ?? true,

    // Not masked like the S3/GSC secrets: IndexNow requires the key be
    // publicly retrievable over HTTP, so hiding it from the owner would be
    // security theatre over a value the site itself publishes.
    indexNowKey: row?.indexNowKey || "",
    indexNowEnabled: row?.indexNowEnabled ?? false,
    googleIndexingApiEnabled: row?.googleIndexingApiEnabled ?? false,
    newsSitemapEnabled: row?.newsSitemapEnabled ?? false,
    robotsExtraRules: row?.robotsExtraRules || "",
    robotsExtraSitemaps: row?.robotsExtraSitemaps || "",

    businessName: row?.businessName || "",
    businessLegalName: row?.businessLegalName || "",
    businessType: row?.businessType || "",
    businessPhone: row?.businessPhone || "",
    businessEmail: row?.businessEmail || "",
    addressStreet: row?.addressStreet || "",
    addressCity: row?.addressCity || "",
    addressRegion: row?.addressRegion || "",
    addressPostalCode: row?.addressPostalCode || "",
    addressCountry: row?.addressCountry || "",
    geoLatitude: row?.geoLatitude || "",
    geoLongitude: row?.geoLongitude || "",
    priceRange: row?.priceRange || "",
    openingHours: parseJsonArray<OpeningHoursEntry>(row?.openingHours),
    serviceAreaNames: parseJsonArray<string>(row?.serviceAreaNames),
    socialProfileUrls: parseJsonArray<string>(row?.socialProfileUrls),
  }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate
  if (!canManageSettings(resolveRole(session.user.role))) {
    return NextResponse.json({ message: SETTINGS_FORBIDDEN }, { status: 403 })
  }

  return NextResponse.json({ data: await serializeSettings(), message: "OK" })
}

export async function PATCH(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate
  if (!canManageSettings(resolveRole(session.user.role))) {
    return NextResponse.json({ message: SETTINGS_FORBIDDEN }, { status: 403 })
  }

  const parsed = updateSiteSettingsSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  // MOVING STORAGE IS A MIGRATION, NOT A SETTINGS EDIT.
  //
  // Enforced on the SERVER, not only by disabling inputs. The form is one
  // client; this route is the rule. Changing the bucket or endpoint used to be
  // an ordinary save that pointed FlowCMS at an empty location and left every
  // existing image behind, with nothing copied and no way back.
  //
  // Credentials for the CURRENT location are untouched by this check — a
  // rotation moves no files and an operator with a leaked key needs it now.
  const row = await getSettingsRow()
  const topologyProblem = rejectTopologyChange(
    {
      endpoint: row?.s3Endpoint || process.env.S3_ENDPOINT,
      region: row?.s3Region || process.env.S3_REGION,
      bucket: row?.s3Bucket || process.env.S3_BUCKET || "",
    },
    {
      endpoint: parsed.data.s3Endpoint,
      region: parsed.data.s3Region,
      bucket: parsed.data.s3Bucket,
    },
  )
  if (topologyProblem) {
    return NextResponse.json({ message: [topologyProblem] }, { status: 409 })
  }

  // Empty string means "clear this override, fall back to the env var" —
  // stored as null, not "". Absent (undefined) means the field wasn't part
  // of this submission and is left exactly as it is.
  const nullable = (value: string | undefined) => (value === undefined ? undefined : value || null)

  const updates: Partial<typeof settings.$inferInsert> = { updatedAt: new Date() }
  if (parsed.data.siteName !== undefined) updates.siteName = nullable(parsed.data.siteName)
  if (parsed.data.tagline !== undefined) updates.tagline = nullable(parsed.data.tagline)
  if (parsed.data.logoKey !== undefined) updates.logoKey = nullable(parsed.data.logoKey)
  if (parsed.data.logoAltText !== undefined) updates.logoAltText = nullable(parsed.data.logoAltText)
  if (parsed.data.faviconKey !== undefined) updates.faviconKey = nullable(parsed.data.faviconKey)
  if (parsed.data.baseUrl !== undefined) updates.baseUrl = nullable(parsed.data.baseUrl)
  if (parsed.data.s3Endpoint !== undefined) updates.s3Endpoint = nullable(parsed.data.s3Endpoint)
  if (parsed.data.s3Region !== undefined) updates.s3Region = nullable(parsed.data.s3Region)
  if (parsed.data.s3Bucket !== undefined) updates.s3Bucket = nullable(parsed.data.s3Bucket)
  if (parsed.data.s3AccessKeyId !== undefined) updates.s3AccessKeyId = nullable(parsed.data.s3AccessKeyId)

  // The secret is the one field a blank submission must NOT touch — every
  // other field's current value is visible in the form, this one never is,
  // so "left blank" can't be told apart from "user didn't mean to change
  // it." Only an explicit clear checkbox, or a genuinely non-empty value,
  // writes to it.
  if (parsed.data.clearS3SecretAccessKey) {
    updates.s3SecretAccessKey = null
  } else if (parsed.data.s3SecretAccessKey) {
    updates.s3SecretAccessKey = parsed.data.s3SecretAccessKey
  }

  if (parsed.data.gscClientId !== undefined) updates.gscClientId = nullable(parsed.data.gscClientId)
  if (parsed.data.gscSiteUrl !== undefined) updates.gscSiteUrl = nullable(parsed.data.gscSiteUrl)

  // Clearing the client secret also clears the refresh token — a token
  // minted under the old secret can no longer be exchanged for an access
  // token, so leaving it in place would just fail silently on next use.
  if (parsed.data.clearGscClientSecret) {
    updates.gscClientSecret = null
    updates.gscRefreshToken = null
  } else if (parsed.data.gscClientSecret) {
    updates.gscClientSecret = parsed.data.gscClientSecret
  }

  if (parsed.data.clearGscRefreshToken) {
    updates.gscRefreshToken = null
  }

  if (parsed.data.clearPagespeedApiKey) {
    updates.pagespeedApiKey = null
  } else if (parsed.data.pagespeedApiKey) {
    updates.pagespeedApiKey = parsed.data.pagespeedApiKey
  }

  if (parsed.data.bingSiteUrl !== undefined) updates.bingSiteUrl = nullable(parsed.data.bingSiteUrl)
  if (parsed.data.clearBingApiKey) {
    updates.bingApiKey = null
  } else if (parsed.data.bingApiKey) {
    updates.bingApiKey = parsed.data.bingApiKey
  }

  // -- Meta templates --------------------------------------------------------
  if (parsed.data.metaTitleTemplate !== undefined) updates.metaTitleTemplate = nullable(parsed.data.metaTitleTemplate)
  if (parsed.data.metaDescriptionTemplate !== undefined) updates.metaDescriptionTemplate = nullable(parsed.data.metaDescriptionTemplate)
  if (parsed.data.categoryTitleTemplate !== undefined) updates.categoryTitleTemplate = nullable(parsed.data.categoryTitleTemplate)
  if (parsed.data.tagTitleTemplate !== undefined) updates.tagTitleTemplate = nullable(parsed.data.tagTitleTemplate)
  if (parsed.data.authorTitleTemplate !== undefined) updates.authorTitleTemplate = nullable(parsed.data.authorTitleTemplate)
  if (parsed.data.titleSeparator !== undefined) updates.titleSeparator = nullable(parsed.data.titleSeparator)

  // -- Link handling ---------------------------------------------------------
  if (parsed.data.externalLinkRel !== undefined) updates.externalLinkRel = nullable(parsed.data.externalLinkRel)
  if (parsed.data.externalLinkNewTab !== undefined) updates.externalLinkNewTab = parsed.data.externalLinkNewTab

  // -- Indexing --------------------------------------------------------------
  // indexNowKey is deliberately absent: it is generated by
  // /api/integrations/indexnow, never typed. A hand-entered key that doesn't
  // match the file served at keyLocation makes every submission fail with a
  // 403 that surfaces nowhere.
  if (parsed.data.indexNowEnabled !== undefined) updates.indexNowEnabled = parsed.data.indexNowEnabled
  if (parsed.data.googleIndexingApiEnabled !== undefined) updates.googleIndexingApiEnabled = parsed.data.googleIndexingApiEnabled
  if (parsed.data.newsSitemapEnabled !== undefined) updates.newsSitemapEnabled = parsed.data.newsSitemapEnabled
  if (parsed.data.robotsExtraRules !== undefined) updates.robotsExtraRules = nullable(parsed.data.robotsExtraRules)
  if (parsed.data.robotsExtraSitemaps !== undefined) updates.robotsExtraSitemaps = nullable(parsed.data.robotsExtraSitemaps)

  // -- Business / LocalBusiness ----------------------------------------------
  if (parsed.data.businessName !== undefined) updates.businessName = nullable(parsed.data.businessName)
  if (parsed.data.businessLegalName !== undefined) updates.businessLegalName = nullable(parsed.data.businessLegalName)
  if (parsed.data.businessType !== undefined) updates.businessType = nullable(parsed.data.businessType)
  if (parsed.data.businessPhone !== undefined) updates.businessPhone = nullable(parsed.data.businessPhone)
  if (parsed.data.businessEmail !== undefined) updates.businessEmail = nullable(parsed.data.businessEmail)
  if (parsed.data.addressStreet !== undefined) updates.addressStreet = nullable(parsed.data.addressStreet)
  if (parsed.data.addressCity !== undefined) updates.addressCity = nullable(parsed.data.addressCity)
  if (parsed.data.addressRegion !== undefined) updates.addressRegion = nullable(parsed.data.addressRegion)
  if (parsed.data.addressPostalCode !== undefined) updates.addressPostalCode = nullable(parsed.data.addressPostalCode)
  if (parsed.data.addressCountry !== undefined) updates.addressCountry = nullable(parsed.data.addressCountry)
  if (parsed.data.geoLatitude !== undefined) updates.geoLatitude = nullable(parsed.data.geoLatitude.trim())
  if (parsed.data.geoLongitude !== undefined) updates.geoLongitude = nullable(parsed.data.geoLongitude.trim())
  if (parsed.data.priceRange !== undefined) updates.priceRange = nullable(parsed.data.priceRange)

  // The three JSON columns. Blank rows are dropped rather than rejected — a
  // repeatable-row editor always leaves one behind, and failing the whole save
  // over an empty text box would be hostile. An empty result stores null, not
  // "[]", so it reads back as "not overridden" and falls through to
  // business.ts, matching how every other field on this route behaves.
  if (parsed.data.openingHours !== undefined) {
    updates.openingHours = parsed.data.openingHours.length
      ? JSON.stringify(parsed.data.openingHours)
      : null
  }
  if (parsed.data.serviceAreaNames !== undefined) {
    const areas = parsed.data.serviceAreaNames.map((name) => name.trim()).filter(Boolean)
    updates.serviceAreaNames = areas.length ? JSON.stringify(areas) : null
  }
  if (parsed.data.socialProfileUrls !== undefined) {
    const urls = parsed.data.socialProfileUrls.map((url) => url.trim()).filter(Boolean)
    updates.socialProfileUrls = urls.length ? JSON.stringify(urls) : null
  }

  // Read before the write so the log can say what actually moved. The settings
  // form submits every field on every save, so listing the submitted keys would
  // report forty changes each time and be worth nothing.
  const before = (await getSettingsRow()) ?? {}

  await upsert(
    settings,
    { id: SETTINGS_SINGLETON_ID, ...updates },
    { target: settings.id, set: updates },
  )

  await invalidateSettingsCache()

  // Secrets are named, never valued — and only as "was set" / "was cleared",
  // because even the length of an S3 key is not something an audit trail needs
  // to carry.
  const changedSecrets: string[] = []
  if ("s3SecretAccessKey" in updates) {
    changedSecrets.push(updates.s3SecretAccessKey ? "S3 secret key set" : "S3 secret key cleared")
  }
  if ("gscClientSecret" in updates) {
    changedSecrets.push(
      updates.gscClientSecret ? "Search Console secret set" : "Search Console secret cleared"
    )
  }
  if ("gscRefreshToken" in updates && !("gscClientSecret" in updates)) {
    changedSecrets.push("Search Console connection revoked")
  }
  if ("pagespeedApiKey" in updates) {
    changedSecrets.push(updates.pagespeedApiKey ? "PageSpeed API key set" : "PageSpeed API key cleared")
  }
  if ("bingApiKey" in updates) {
    changedSecrets.push(updates.bingApiKey ? "Bing Webmaster API key set" : "Bing Webmaster API key cleared")
  }

  const changed = changedFieldLabels(
    before as Record<string, unknown>,
    updates as Record<string, unknown>,
    // Built from the update keys themselves: settings has ~46 columns and a
    // hand-written label map would fall behind the next field someone adds.
    // Secrets are excluded here and reported separately above.
    Object.fromEntries(
      Object.keys(updates)
        .filter(
          (key) =>
            !["updatedAt", "s3SecretAccessKey", "gscClientSecret", "gscRefreshToken", "pagespeedApiKey", "bingApiKey"].includes(key)
        )
        .map((key) => [key, key])
    )
  )

  await recordActivity({
    actor: session.user,
    action: "updated",
    entityType: "settings",
    // The settings row is a singleton with a fixed id, so there is nothing
    // useful to filter one entry from another by.
    entityId: null,
    entityLabel: "Site settings",
    summary: [...changedSecrets, summariseChanges(changed)].join(" · "),
    metadata: { changed },
  })

  return NextResponse.json({ data: await serializeSettings(), message: "Settings updated" })
}
