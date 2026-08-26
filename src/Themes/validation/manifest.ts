import { z } from "zod"
import { isCompatible } from "./compat"
import { FLOWCMS_VERSION } from "@/Framework/Config/version"
import { validateSettingsDefinition } from "./settingsDefinition"
import type { FlowCMSTheme, ThemeManifest } from "@/Themes/contract/views"

/**
 * Manifest validation.
 *
 * Zod is already a FlowCMS dependency and is the validator every other
 * boundary in this codebase uses, so themes are validated the same way post
 * bodies and settings are rather than by a bespoke checker.
 *
 * Validation runs at REGISTRY CONSTRUCTION — that is, at module load, which
 * for a static registry means effectively at build. A malformed manifest is a
 * broken build, not a runtime surprise on somebody's homepage.
 */

/** Same shape as content slugs elsewhere in FlowCMS: lowercase, digits,
 *  hyphens. It ends up in URLs, config files and package names. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SEMVER = /^\d+\.\d+\.\d+$/
/** Slot names are referenced by admins and stored against menus. */
const SLOT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const themeManifestSchema = z.object({
  slug: z.string().min(1, "Theme slug is required").max(64).regex(SLUG, "Theme slug must be lowercase letters, numbers and hyphens"),
  name: z.string().min(1, "Theme name is required").max(120),
  version: z.string().regex(SEMVER, "Theme version must be x.y.z"),
  flowcmsCompat: z.string().min(1, "flowcmsCompat is required"),
  menuSlots: z
    .array(z.string().regex(SLOT, "Menu slot names must be lowercase letters, numbers and hyphens").max(40))
    // A theme with no navigation slots is legitimate — a single-page theme has
    // nowhere to put a menu — so this is not `.min(1)`.
    .max(10, "A theme may declare at most 10 menu slots"),
  description: z.string().max(500).optional(),
  author: z.string().max(120).optional(),
  authorUrl: z.string().url("authorUrl must be a URL").max(300).optional(),
  screenshot: z.string().max(300).optional(),
})

export type ThemeValidation =
  | { ok: true; manifest: ThemeManifest }
  | { ok: false; errors: string[] }

/** Validate a manifest's shape. Does NOT check FlowCMS compatibility — see
 *  `validateTheme`, which checks both and is what the registry uses. */
export function validateManifest(value: unknown): ThemeValidation {
  const parsed = themeManifestSchema.safeParse(value)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) }
  }
  return { ok: true, manifest: parsed.data }
}

export type ThemeCheck =
  | { ok: true; theme: FlowCMSTheme }
  | { ok: false; errors: string[] }

/**
 * Validate a whole theme: manifest shape, FlowCMS compatibility, and the
 * required surfaces.
 *
 * `Layout` is required and every other surface is optional, because core falls
 * back to the default theme per-surface. A theme with no Layout has no shell
 * to render anything into, which is not a fallback situation — it is a broken
 * package.
 */
export function validateTheme(
  value: unknown,
  flowcmsVersion: string = FLOWCMS_VERSION,
): ThemeCheck {
  if (typeof value !== "object" || value === null) {
    return { ok: false, errors: ["Theme must be an object"] }
  }

  const candidate = value as Partial<FlowCMSTheme>
  const errors: string[] = []

  const manifestResult = validateManifest(candidate.manifest)
  if (!manifestResult.ok) {
    errors.push(...manifestResult.errors)
  } else if (!isCompatible(manifestResult.manifest.flowcmsCompat, flowcmsVersion)) {
    // Named explicitly on both sides: "incompatible" without the numbers sends
    // an operator to read source to find out what they have.
    errors.push(
      `Theme "${manifestResult.manifest.slug}" declares flowcmsCompat ` +
        `"${manifestResult.manifest.flowcmsCompat}", which does not accept FlowCMS ${flowcmsVersion}`,
    )
  }

  if (typeof candidate.Layout !== "function") {
    errors.push("Theme must export a Layout component")
  }

  // A malformed settings definition makes the theme unavailable, exactly like a
  // malformed manifest. Deferring it would mean the failure surfaced when an
  // operator opened the settings screen, which is the worst place to learn a
  // theme is broken.
  const settings = validateSettingsDefinition(candidate.settings)
  if (!settings.ok) {
    errors.push(...settings.errors.map((error) => `settings: ${error}`))
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, theme: value as FlowCMSTheme }
}
