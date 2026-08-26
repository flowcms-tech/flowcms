import type { ThemeSettingsDefinition, ThemeSettingsValues } from "@/Themes/contract"

/**
 * The declared defaults for a settings definition, as a theme would receive
 * them with no row stored.
 *
 * Rendering tests care about markup, not persistence, so they need a settings
 * object without standing up a database. This produces exactly what
 * `resolveSettingsRow` produces for `row: null` — the same values a fresh
 * install renders with — so a render test and the real site agree.
 */
export function themeDefaults(definition: ThemeSettingsDefinition | undefined): ThemeSettingsValues {
  const values: Record<string, string | number | boolean> = Object.create(null)
  for (const field of definition?.fields ?? []) values[field.key] = field.default
  return values
}

/** For a theme with no settings, or a surface whose values do not matter. */
export const NO_SETTINGS: ThemeSettingsValues = Object.freeze(Object.create(null))
