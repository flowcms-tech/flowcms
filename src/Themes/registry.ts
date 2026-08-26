import { validateManifest, validateTheme } from "./validation/manifest"
import type { FlowCMSTheme } from "./contract/views"
import { DEFAULT_THEME_SLUG } from "./constants"
import { defaultTheme } from "./default"
// flowcms:template-strip:start — the integration theme is a repository fixture
import { integrationThemes } from "./integration"
// flowcms:template-strip:end
import { packageThemes } from "./packages"

/**
 * The installed themes.
 *
 * STATIC BY CONSTRUCTION. Every theme is an explicit `import` above and an
 * explicit entry below — no filesystem scan, no `import(variable)`. That is
 * not a style preference:
 *
 *   - Next's build traces static imports to decide what reaches the standalone
 *     output. A theme discovered by reading a directory at runtime is a theme
 *     the tracer never saw, so it is simply absent from the production image,
 *     and the failure surfaces as a 500 on the customer's homepage rather than
 *     as a build error. Phase 4 and Phase 5 each lost a day to exactly this
 *     class of bug, with database drivers and migration SQL.
 *   - A directory scan would let anything dropped into `src/Themes/` execute
 *     with server privileges. Installing a theme should be a deliberate,
 *     reviewable change to this file.
 *
 * Theme ACTIVATION is runtime — an admin switches themes without a rebuild, and
 * the choice lives in `settings.activeTheme`. Only theme INSTALLATION requires
 * a build, which is the same trade every Next.js application makes for every
 * dependency it has. There is deliberately no `installed_themes` table: what is
 * installed is a property of the artifact, and two sources of truth for that
 * would disagree the first time somebody deployed.
 */
export type ThemeEntry = [key: string, theme: FlowCMSTheme]

const INSTALLED: ThemeEntry[] = [
  ["default", defaultTheme],
  // flowcms:template-strip:start
  ...integrationThemes(),
  // flowcms:template-strip:end
  ...packageThemes(),
]

/** Re-exported so existing imports are unchanged. It lives in `./constants`
 *  because the admin view model needs it in the browser, and importing it from
 *  here would drag every installed theme's components into the client bundle. */
export { DEFAULT_THEME_SLUG } from "./constants"

/** Why an installed theme cannot be activated. */
export type UnavailableReason = "invalid" | "incompatible"

/**
 * One entry in the registry.
 *
 * A theme can be present in the build and still not be usable, which is the
 * distinction Phase 6.3 exists to model. `theme` is null exactly when
 * `available` is false, so nothing can render an unusable theme by accident.
 */
export type InstalledTheme =
  | { slug: string; available: true; theme: FlowCMSTheme }
  | {
      slug: string
      available: false
      theme: null
      reason: UnavailableReason
      /** Human-readable, for the operator-facing status in 6.4. Never a stack
       *  trace and never a raw value from outside the build. */
      problems: string[]
    }

/**
 * Build the registry.
 *
 * WHAT THROWS AND WHAT DOES NOT — the central decision of this file, and it is
 * not symmetric on purpose.
 *
 * THROWS. Two classes, both of which make the registry itself meaningless:
 *
 *   - The default theme is missing, invalid, or does not accept this FlowCMS
 *     version. It is the fallback for everything; a build without a usable one
 *     cannot render the public site at all, and falling back from the fallback
 *     is not a thing. This is a corrupt build and should stop the process.
 *   - A duplicate slug, or a key that disagrees with its manifest's slug.
 *     These are authoring bugs in THIS file, and they make activation
 *     nondeterministic — "activate aurora" would resolve to whichever of two
 *     entries happened to win.
 *
 * DOES NOT THROW. A non-default theme that is invalid or incompatible is
 * recorded as installed-but-unavailable and the build continues.
 *
 * That second rule is new in 6.3, and it exists because of a situation that is
 * ordinary rather than exceptional: an operator activates `aurora`, then
 * upgrades FlowCMS, and `aurora` declares `^0.1.0` while the new version is
 * 0.2.0. Under the old rule the upgraded container would refuse to start —
 * their whole site down, admin panel included, because of a theme. Now it
 * starts, renders through the default theme, and the admin panel can tell them
 * exactly which theme is stuck and why.
 */
function buildRegistry(installed: ThemeEntry[]): Map<string, InstalledTheme> {
  const registry = new Map<string, InstalledTheme>()
  const fatal: string[] = []
  const seenSlugs = new Map<string, string>()

  for (const [key, theme] of installed) {
    // The manifest is read before the theme is validated, because an entry
    // whose slug cannot even be determined cannot be recorded as unavailable —
    // there is no key to record it under.
    const manifest = validateManifest((theme as Partial<FlowCMSTheme>)?.manifest)
    if (!manifest.ok) {
      fatal.push(`Theme "${key}": ${manifest.errors.join("; ")}`)
      continue
    }

    const { slug } = manifest.manifest

    // The key is what the database stores as the active theme and what the
    // Appearance screen shows; the slug is what the theme calls itself. If they
    // disagree, activating a theme by name silently activates nothing.
    if (slug !== key) {
      fatal.push(`Theme "${key}" declares slug "${slug}" — registry key and manifest slug must match`)
      continue
    }

    const duplicate = seenSlugs.get(slug)
    if (duplicate !== undefined) {
      fatal.push(`Duplicate theme slug "${slug}" — registered twice, as "${duplicate}" and "${key}"`)
      continue
    }
    seenSlugs.set(slug, key)

    const result = validateTheme(theme)
    if (result.ok) {
      registry.set(slug, { slug, available: true, theme: result.theme })
      continue
    }

    if (slug === DEFAULT_THEME_SLUG) {
      fatal.push(`Theme "${key}": ${result.errors.join("; ")}`)
      continue
    }

    // An incompatible theme is a theme that will work again after an upgrade or
    // a theme update; an invalid one needs its author. Telling them apart is
    // what lets 6.4 write a message an operator can act on.
    const incompatible = result.errors.some((error) => error.includes("flowcmsCompat"))
    registry.set(slug, {
      slug,
      available: false,
      theme: null,
      reason: incompatible ? "incompatible" : "invalid",
      problems: result.errors,
    })
  }

  const fallback = registry.get(DEFAULT_THEME_SLUG)
  if (!fallback?.available) {
    fatal.push(
      `The "${DEFAULT_THEME_SLUG}" theme is missing or unusable. It is the fallback for every ` +
        `surface, so a build without it cannot render the public site.`,
    )
  }

  if (fatal.length > 0) {
    throw new Error(`FlowCMS theme registry is invalid:\n  - ${fatal.join("\n  - ")}`)
  }

  return registry
}

const REGISTRY = buildRegistry(INSTALLED)

/** Exposed for tests; production code goes through the accessors below. */
export { buildRegistry }

/** Every installed theme, usable or not. 6.4's Appearance screen needs the
 *  unusable ones too — an operator cannot fix a theme they cannot see. */
export function listInstalledThemes(): InstalledTheme[] {
  return [...REGISTRY.values()]
}

/** Only the themes that can actually render. */
export function listThemes(): FlowCMSTheme[] {
  return listInstalledThemes().flatMap((entry) => (entry.available ? [entry.theme] : []))
}

/**
 * The registry entry for `slug`, or undefined if this build has no such theme.
 *
 * Returns the entry rather than the theme so callers can tell "no such theme"
 * from "that theme exists but cannot be used, for this reason" — a distinction
 * the resolver needs and a boolean cannot carry.
 */
export function getInstalledTheme(slug: string): InstalledTheme | undefined {
  return REGISTRY.get(slug)
}

/** The renderable theme for `slug`, or undefined. Undefined covers both "not
 *  installed" and "installed but unavailable"; use `getInstalledTheme` when the
 *  difference matters. */
export function getTheme(slug: string): FlowCMSTheme | undefined {
  const entry = REGISTRY.get(slug)
  return entry?.available ? entry.theme : undefined
}

export function getDefaultTheme(): FlowCMSTheme {
  const entry = REGISTRY.get(DEFAULT_THEME_SLUG)
  // Non-null: `buildRegistry` threw at module load if this were unusable.
  return (entry as Extract<InstalledTheme, { available: true }>).theme
}
