import type { ThemeEntry } from "@/Themes/registry"
import { integrationTheme } from "./theme"

/**
 * Registration of the integration theme, gated on an environment variable.
 *
 * Phase 6.3 has to prove that changing `settings.activeTheme` changes the HTML
 * a real route serves. That needs a second theme the resolver can genuinely
 * select — and shipping a fake theme in the Appearance list of every FlowCMS
 * install would be product clutter of exactly the kind the brief rules out.
 *
 * The gate is a RUNTIME env check, not a build flag, and that is the point:
 * the same production image an operator runs is the image the switching proof
 * runs against. A separate "integration build" would prove that a different
 * artifact works. The cost is about a kilobyte of unreferenced markup in the
 * bundle; the benefit is that the proof is about the real thing.
 *
 * Read once at module load, alongside the registry it feeds — the registry is
 * static and validated once, so this cannot be toggled per request.
 *
 * Not documented in `.env.example` on purpose. It is a test seam, not a
 * feature, and an operator who sets it gets a theme that says so in its name.
 */
export function integrationThemes(): ThemeEntry[] {
  if (process.env.FLOWCMS_INTEGRATION_THEMES !== "1") return []
  return [["integration", integrationTheme]]
}

export { integrationTheme, integrationThemeSettings, INTEGRATION_MARKER, INTEGRATION_NAV_MARKER } from "./theme"
