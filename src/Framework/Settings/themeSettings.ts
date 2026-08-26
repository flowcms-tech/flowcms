import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { themeSettings } from "@/db/tables"
import { upsert } from "@/db/writes"
import { CacheService } from "@/Framework/Redis/CacheService"
import { getInstalledTheme } from "@/Themes/registry"
import type { ThemeSettingsDefinition, ThemeSettingValue } from "@/Themes/contract/settings"
import { isWellFormedThemeSlug } from "./themeSelection"
import {
  coerceSettingValue,
  resolveSettingsRow,
  MAX_SETTINGS_BYTES,
  type ResolvedThemeSettings,
} from "./themeSettingsResolve"

/**
 * Reading and writing a theme's settings.
 *
 * The same asymmetry as every other FlowCMS domain boundary, and for the same
 * reason:
 *
 *   THE WRITE PATH IS STRICT. It refuses an unknown key, a wrong-typed value,
 *   an out-of-range number, a select value that is not an option, a colour that
 *   is not a colour, an uninstalled or unavailable theme, and an oversized
 *   payload. New bad state is never created.
 *
 *   THE READ PATH IS RESILIENT. It returns a complete, correctly-typed settings
 *   object whatever the row holds, and never repairs the row.
 *
 * DATABASE FAILURES PROPAGATE. If the query throws, this throws. A corrupt row
 * and an unreachable database are different failures: quietly answering
 * "defaults" during an outage would render every site with its stock appearance
 * and tell nobody. Only rows that were read successfully reach the resolver.
 *
 * Lives in Settings rather than in `src/Themes/` so that theme code never
 * imports the database client.
 *
 * NO `server-only` MARKER, matching `themeSelection.ts` in the same layer and
 * for the same reason: the ThemeResolver imports both, and the resolver is
 * imported by route modules and by the unit suite. A `server-only` marker here
 * would make every one of those imports throw. What actually keeps this off the
 * client is `@/db/client` — a browser bundle cannot resolve it — and
 * `tests/architecture/layering.test.ts`, which pins where database access may
 * live.
 */

const CACHE_PREFIX = "theme-settings:"
/** Matches the settings-row TTL. Every mutation invalidates, so the ceiling
 *  only bounds staleness after an out-of-band change, never after a Save. */
const CACHE_TTL_SECONDS = 300

interface StoredRow {
  settingsJson: string
  schemaVersion: number
}

function definitionOf(slug: string): ThemeSettingsDefinition | null {
  const installed = getInstalledTheme(slug)
  // An unavailable theme's definition is not offered: it failed validation, so
  // whatever it declares cannot be trusted to describe its own values.
  if (!installed?.available) return null
  return installed.theme.settings ?? null
}

async function readRow(slug: string): Promise<StoredRow | null> {
  const cached = await CacheService.getJson<StoredRow | { none: true }>(`${CACHE_PREFIX}${slug}`)
  if (cached) return "none" in cached ? null : cached

  const [row] = await db
    .select({ settingsJson: themeSettings.settingsJson, schemaVersion: themeSettings.schemaVersion })
    .from(themeSettings)
    .where(eq(themeSettings.themeSlug, slug))
    .limit(1)

  // "No row" is cached too, as a sentinel. A fresh install has no rows at all,
  // and the common case should not pay for a query on every public request.
  await CacheService.setJson(`${CACHE_PREFIX}${slug}`, row ?? { none: true }, CACHE_TTL_SECONDS)
  return row ?? null
}

async function invalidate(slug: string): Promise<void> {
  await CacheService.del(`${CACHE_PREFIX}${slug}`)
}

/**
 * The resolved settings for one theme.
 *
 * Safe to call for a theme that is not installed, not available, or has no
 * settings: all three resolve to an empty value set rather than an error, so
 * callers do not branch. A stored row for an uninstalled theme is left alone.
 */
export async function getThemeSettings(slug: string): Promise<ResolvedThemeSettings> {
  const definition = definitionOf(slug)
  const row = await readRow(slug)

  return resolveSettingsRow({
    themeSlug: slug,
    definition,
    row: row ? { values: row.settingsJson, schemaVersion: row.schemaVersion } : null,
  })
}

export type ThemeSettingsWriteResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: string }

function refuse(error: string): ThemeSettingsWriteResult {
  return { ok: false, error }
}

/**
 * Replace a theme's settings.
 *
 * WHOLE-FORM SEMANTICS for the fields the theme currently declares: every
 * declared field is written, taking its value from `values` when present and
 * its default otherwise. A partial-patch API would need the client and the
 * server to agree about which fields were "left alone", and two admins saving
 * at once would produce a mixture neither chose.
 *
 * UNKNOWN HISTORICAL KEYS ARE CARRIED FORWARD. A stored key the current
 * definition does not declare may belong to a newer version of the theme an
 * operator is about to reinstall; dropping it because today's form cannot
 * render it would be data loss caused by an upgrade. They are preserved in the
 * row and still never handed to the theme.
 */
export async function setThemeSettings(
  slug: string,
  values: Record<string, unknown>,
): Promise<ThemeSettingsWriteResult> {
  const candidate = slug.trim()

  if (!isWellFormedThemeSlug(candidate)) {
    return refuse("Theme slug must be lowercase letters, numbers and hyphens.")
  }

  const installed = getInstalledTheme(candidate)
  if (!installed) {
    return refuse(`No theme "${candidate}" is installed in this build.`)
  }
  if (!installed.available) {
    return refuse(`Theme "${candidate}" cannot be configured because it is not usable in this build.`)
  }

  const definition = installed.theme.settings ?? null
  if (!definition) {
    return refuse(`Theme "${candidate}" does not define any settings.`)
  }

  const declared = new Map(definition.fields.map((field) => [field.key, field]))

  // Unknown keys are REFUSED on a new write, even though unknown keys already
  // in the row are preserved. The difference is intent: an old row is history,
  // a new key in a submission is a client sending something this build does not
  // understand, and accepting it would make the strict path meaningless.
  for (const key of Object.keys(values)) {
    if (!declared.has(key)) {
      return refuse(`"${key}" is not a setting this theme defines.`)
    }
  }

  const next: Record<string, ThemeSettingValue> = {}
  for (const field of definition.fields) {
    if (!(field.key in values)) {
      next[field.key] = field.default
      continue
    }
    const coerced = coerceSettingValue(field, values[field.key])
    if (coerced === undefined) {
      return refuse(`The value for "${field.label}" is not valid.`)
    }
    next[field.key] = coerced
  }

  const existing = await readRow(candidate)

  // Whatever the row holds that the definition no longer declares.
  const carried: Record<string, unknown> = {}
  if (existing) {
    const resolved = resolveSettingsRow({
      themeSlug: candidate,
      definition,
      row: { values: existing.settingsJson, schemaVersion: existing.schemaVersion },
    })
    Object.assign(carried, resolved.unknownValues)
  }

  const merged = { ...carried, ...next }
  const settingsJson = JSON.stringify(merged)

  if (Buffer.byteLength(settingsJson, "utf8") > MAX_SETTINGS_BYTES) {
    return refuse(`These settings are too large. The limit is ${MAX_SETTINGS_BYTES} bytes.`)
  }

  if (
    existing &&
    existing.settingsJson === settingsJson &&
    existing.schemaVersion === definition.version
  ) {
    // Idempotent. Nothing written, no timestamp moved, and the caller writes no
    // activity entry — a "settings updated" line for a save that changed
    // nothing makes the log less trustworthy, not more.
    return { ok: true, changed: false }
  }

  const now = new Date()
  await upsert(
    themeSettings,
    {
      themeSlug: candidate,
      settingsJson,
      schemaVersion: definition.version,
      createdAt: now,
      updatedAt: now,
    },
    {
      target: themeSettings.themeSlug,
      set: { settingsJson, schemaVersion: definition.version, updatedAt: now },
    },
  )
  await invalidate(candidate)

  return { ok: true, changed: true }
}

/**
 * Return a theme to its declared defaults by DELETING its row.
 *
 * "No overrides" is the absence of a row, not a stored copy of every default.
 * Storing the defaults would freeze them: a theme update that changed a default
 * would not reach an operator who had once pressed Reset.
 */
export async function resetThemeSettings(slug: string): Promise<ThemeSettingsWriteResult> {
  const candidate = slug.trim()

  if (!isWellFormedThemeSlug(candidate)) {
    return refuse("Theme slug must be lowercase letters, numbers and hyphens.")
  }
  if (!getInstalledTheme(candidate)) {
    return refuse(`No theme "${candidate}" is installed in this build.`)
  }

  const existing = await readRow(candidate)
  if (!existing) return { ok: true, changed: false }

  await db.delete(themeSettings).where(eq(themeSettings.themeSlug, candidate))
  await invalidate(candidate)

  return { ok: true, changed: true }
}

/** Exposed for the admin screen, which lists what is configurable. */
export function themeSettingsDefinition(slug: string): ThemeSettingsDefinition | null {
  return definitionOf(slug)
}
