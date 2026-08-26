import "server-only"
import { listInstalledThemes } from "@/Themes/registry"
import { getThemeStatus } from "@/Themes/resolver"
import { getThemeSettings } from "@/Framework/Settings/themeSettings"
import type { ThemeSettingsIssue } from "@/Framework/Settings/themeSettingsResolve"
import type { ThemeSettingField, ThemeSettingValue } from "@/Themes/contract/settings"

/**
 * The Theme Settings screen's data.
 *
 * `server-only` because `listInstalledThemes()` returns registry entries
 * holding React components; importing this from a client component would pull
 * every installed theme into the browser bundle.
 *
 * WHAT CROSSES TO THE BROWSER is the definition as plain metadata plus the
 * resolved values — never a theme object, never a registry entry, never the
 * validator's internals, never the raw stored JSON. The admin form is generated
 * from the metadata; a theme cannot inject React into the admin panel, and this
 * boundary is where that stops being a promise and becomes a shape.
 */

export interface ThemeChoice {
  slug: string
  name: string
  /** True for the theme the public site is rendering right now. */
  rendering: boolean
  /** True when the theme declares settings at all. */
  configurable: boolean
}

export interface ThemeSettingsAdminView {
  /** The theme being configured. */
  slug: string
  name: string
  /** Whether this theme is the one currently rendering the public site. */
  rendering: boolean
  /** Every installed, available theme, so an operator can configure one they
   *  have not activated. Selecting one here never activates it. */
  choices: ThemeChoice[]
  /** Null when the theme declares no settings — the admin shows an empty state
   *  rather than inventing controls. */
  fields: ThemeSettingField[] | null
  /** Resolved values: declared defaults overlaid with valid stored values. */
  values: Record<string, ThemeSettingValue>
  /** Whether a row exists. Drives whether "Reset" does anything. */
  stored: boolean
  schemaVersion: number | null
  definitionVersion: number | null
  issues: ThemeSettingsIssue[]
  /** Set when the public site is rendering the default theme because the
   *  selected one is unusable. The screen says so rather than offering fields
   *  for a package whose definition does not exist. */
  fallbackFrom: string | null
}

function choices(): ThemeChoice[] {
  return listInstalledThemes()
    .filter((entry) => entry.available)
    .map((entry) => ({
      slug: entry.slug,
      name: entry.theme.manifest.name,
      rendering: false,
      configurable: Boolean(entry.theme.settings),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Build the screen for one theme.
 *
 * `requested` is the slug an operator picked from the selector. When it names a
 * theme this build does not have — including the theme a stale selection points
 * at during a fallback — the screen falls back to the theme that is actually
 * RENDERING, because that is the one whose definition exists and whose values
 * mean something.
 */
export async function getThemeSettingsAdminView(
  requested?: string,
): Promise<ThemeSettingsAdminView> {
  const status = await getThemeStatus()
  const available = choices().map((choice) => ({
    ...choice,
    rendering: choice.slug === status.activeSlug,
  }))

  const wanted = requested?.trim()
  const target =
    wanted && available.some((choice) => choice.slug === wanted) ? wanted : status.activeSlug

  const entry = listInstalledThemes().find((e) => e.available && e.slug === target)
  const resolved = await getThemeSettings(target)

  return {
    slug: target,
    name: entry?.available ? entry.theme.manifest.name : target,
    rendering: target === status.activeSlug,
    choices: available,
    fields: entry?.available ? (entry.theme.settings?.fields ?? null) : null,
    values: { ...resolved.values },
    stored: resolved.stored,
    schemaVersion: resolved.schemaVersion,
    definitionVersion: resolved.definitionVersion,
    issues: resolved.issues,
    // Only reported when the operator is looking at the theme that stepped in.
    fallbackFrom:
      status.fallback && target === status.activeSlug ? status.requestedSlug : null,
  }
}
