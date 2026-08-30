import type { ComponentType } from "react"
import {
  getActiveThemeSlug,
  isWellFormedThemeSlug,
} from "@/Framework/Settings/themeSelection"
import type { FlowCMSTheme, LayoutProps, ThemeSurface } from "./contract/views"
import type { ThemeSettingsValues } from "./contract/settings"
import { getThemeSettings } from "@/Framework/Settings/themeSettings"
import { DEFAULT_THEME_SLUG, getDefaultTheme, getInstalledTheme } from "./registry"

/**
 * The ThemeResolver: the one place that decides which theme renders.
 *
 * Public routes ask for a surface by name and get a component back. They never
 * name a theme and never read Settings — if they did, eight files would each
 * have their own opinion about what an unusable selection means.
 *
 *     settings.activeTheme  →  registry lookup  →  selected theme or fallback
 *
 * TWO FALLBACKS LIVE HERE AND THEY ARE INDEPENDENT:
 *
 *   THEME-LEVEL. The selected theme is missing, unusable, or its slug is
 *   malformed → render the default theme instead, and say so.
 *
 *   SURFACE-LEVEL. The selected theme is perfectly fine but does not implement
 *   `BlogPost` → use the default theme's `BlogPost`. The site is still running
 *   the selected theme; one surface came from the fallback. `getThemeStatus`
 *   reports the selected theme, not the default, because nothing is wrong.
 *
 * Conflating them would mean a theme that restyles only the blog index gets
 * reported as broken.
 *
 * ASYNC BY DESIGN. Introduced in 6.2 before there was anything to await,
 * precisely so that 6.3 could add this database read without rewriting a single
 * route. That is now what happened.
 */

/** Why the site is not rendering the theme that was asked for. */
export type FallbackReason =
  /** The stored slug is not a valid slug at all — hand-edited or corrupt. */
  | "invalid"
  /** Well-formed, but this build contains no such theme. */
  | "missing"
  /** Installed, but it does not accept this version of FlowCMS. */
  | "incompatible"

export interface ResolvedTheme {
  /** What Settings asked for, or null when nothing is selected. Preserved
   *  verbatim so the admin can be told what broke. */
  requestedSlug: string | null
  /** The slug actually rendering. */
  slug: string
  /** The theme actually rendering. */
  theme: FlowCMSTheme
  /** The default theme, for surfaces `theme` does not implement. */
  fallback: FlowCMSTheme
  /** True only for a THEME-level fallback. A surface falling back does not set
   *  this — see the note above. */
  didFallBack: boolean
  reason: FallbackReason | null
}

/**
 * Resolve the active theme.
 *
 * DOES NOT CATCH DATABASE ERRORS, deliberately. `getActiveThemeSlug` throws if
 * Settings is unreachable, and that propagates. A database outage is not a
 * missing theme: swallowing it here would turn "the database is down" into "the
 * default theme is selected", the site would appear to work, and the real
 * failure would be invisible until somebody noticed their theme had silently
 * reverted. Readiness already reports database health; that is where an outage
 * belongs.
 *
 * NEVER WRITES. If the stored slug is unusable, the column keeps its value.
 * Auto-healing it to "default" would destroy the operator's intent and leave
 * the admin panel unable to explain what happened after a deploy — and it would
 * do so on a GET request, from a render path, silently.
 */
export async function resolveTheme(): Promise<ResolvedTheme> {
  const fallback = getDefaultTheme()
  const requestedSlug = await getActiveThemeSlug()

  const base = { requestedSlug, fallback }
  const fallBackToDefault = (reason: FallbackReason | null) => ({
    ...base,
    slug: DEFAULT_THEME_SLUG,
    theme: fallback,
    didFallBack: reason !== null,
    reason,
  })

  // No selection. The ordinary state of a fresh install, and not a fallback:
  // nothing was asked for, so nothing failed.
  if (requestedSlug === null) return fallBackToDefault(null)

  if (!isWellFormedThemeSlug(requestedSlug)) return fallBackToDefault("invalid")

  const installed = getInstalledTheme(requestedSlug)
  if (!installed) return fallBackToDefault("missing")
  if (!installed.available) return fallBackToDefault(installed.reason)

  return {
    ...base,
    slug: installed.slug,
    theme: installed.theme,
    didFallBack: false,
    reason: null,
  }
}

/**
 * Pick one surface out of a selected theme, falling back to the default.
 *
 * Pure and synchronous — the whole surface-level rule in one expression, so it
 * can be tested against a real partial theme without a resolver, a registry, a
 * database or a request.
 */
export function selectSurface<K extends ThemeSurface>(
  selected: FlowCMSTheme,
  fallback: FlowCMSTheme,
  surface: K,
): NonNullable<FlowCMSTheme[K]> {
  return selectSurfaceEntry(selected, fallback, surface).component
}

/**
 * The component for a surface, together with the theme that OWNS it.
 *
 * The owner matters because settings are per-theme. When the selected theme
 * does not implement a surface, the component that renders belongs to the
 * default theme — and it must be given the DEFAULT theme's settings, not the
 * selected theme's. Handing a default-theme component a set of keys it never
 * declared would be a different theme's namespace leaking into it.
 *
 * So: theme-level fallback and surface-level fallback are different events, and
 * settings follow the IMPLEMENTATION, not the selection.
 */
export function selectSurfaceEntry<K extends ThemeSurface>(
  selected: FlowCMSTheme,
  fallback: FlowCMSTheme,
  surface: K,
): { component: NonNullable<FlowCMSTheme[K]>; owner: FlowCMSTheme } {
  const own = selected[surface]
  const component = own ?? fallback[surface]
  const owner = own ? selected : fallback

  if (!component) {
    // Unreachable while the registry refuses a default theme missing a surface.
    // Worth a named error anyway: without it React renders `undefined` and
    // reports the failure three components away from its cause.
    throw new Error(
      `No theme implements the "${surface}" surface — neither "${selected.manifest.slug}" ` +
        `nor the fallback "${fallback.manifest.slug}".`,
    )
  }

  return { component: component as NonNullable<FlowCMSTheme[K]>, owner }
}

export interface ResolvedSurface<K extends ThemeSurface> {
  Component: NonNullable<FlowCMSTheme[K]>
  /** Settings of the theme whose component this is — see `selectSurfaceEntry`. */
  settings: ThemeSettingsValues
}

/**
 * The component a public route should render for `surface`, and the settings
 * to render it with.
 *
 * ONE CONVENTION FOR EVERY SURFACE, Layout included: core resolves, the route
 * passes both in, the theme renders. A theme never queries, never awaits and
 * never reads a global — which is what keeps a theme a pure function of its
 * props and keeps package themes viable.
 */
/**
 * A null-prototype settings bag, copied into a plain object, at the one
 * boundary where settings stop being internal state and become component props.
 *
 * `Framework/Settings/themeSettingsResolve` builds that bag with
 * `Object.create(null)` deliberately: a stored key named `__proto__` or
 * `constructor` must never reach `Object.prototype` through a later lookup.
 * React's server-to-client serializer refuses a null-prototype object outright
 * — "Classes or null prototypes are not supported" — so the moment a theme
 * surface is a Client Component, handing it that bag crashes the render rather
 * than degrading. `Themes/default/NotFound` is exactly such a component, for
 * framer-motion, which is how this was found: every 404 on the public site.
 *
 * Spreading keeps both properties. Resolution and lookups still work against
 * the hardened prototype-free object; what crosses into a component is a plain
 * copy of it.
 *
 * HERE rather than in the theme or the route. A theme author writing the next
 * Client Component surface cannot be expected to know that the settings they
 * were handed are unserializable, and a fix in `not-found.tsx` would leave
 * them to discover it the same way.
 *
 * A shallow copy is the whole job: every value in the bag is a string, number
 * or boolean, because `validation/settingsDefinition` is what decides what a
 * field may be and admits no nested shapes.
 */
function serializableSettings(values: ThemeSettingsValues): ThemeSettingsValues {
  return { ...values }
}

export async function resolveSurface<K extends ThemeSurface>(
  surface: K,
): Promise<ResolvedSurface<K>> {
  const { theme, fallback } = await resolveThemeAndWarn()
  const { component, owner } = selectSurfaceEntry(theme, fallback, surface)
  return {
    Component: component,
    settings: serializableSettings((await getThemeSettings(owner.manifest.slug)).values),
  }
}

/**
 * The public site shell.
 *
 * Separate from `resolveSurface` because `Layout` is required by the contract
 * rather than optional, so it has no fallback branch to share. A theme without
 * one never becomes available in the first place — the registry marks it
 * invalid — so there is deliberately no surface-level fallback for Layout that
 * would let a broken package render as though it were fine.
 */
export async function resolveLayout(): Promise<ComponentType<LayoutProps>> {
  const { theme } = await resolveThemeAndWarn()
  return theme.Layout
}

/**
 * The Layout together with the navigation slots the rendering theme declares.
 *
 * One resolution, two answers, because `ThemeShell` needs both and resolving
 * twice would read Settings twice per page and — worse — could disagree with
 * itself if the active theme changed between the two calls. The slots come from
 * the theme that is ACTUALLY rendering, so during a fallback the default
 * theme's slots are used, not the unusable selected theme's.
 */
export async function resolveLayoutAndSlots(): Promise<{
  Layout: ComponentType<LayoutProps>
  slots: string[]
  settings: ThemeSettingsValues
}> {
  const { theme } = await resolveThemeAndWarn()
  // Layout has no surface-level fallback — a theme without one never becomes
  // available — so its owner is always the RENDERING theme. During a
  // theme-level fallback that is the default theme, which therefore receives
  // the default theme's settings.
  return {
    Layout: theme.Layout,
    slots: theme.manifest.menuSlots,
    settings: serializableSettings((await getThemeSettings(theme.manifest.slug)).values),
  }
}

// -- Operator-facing status ---------------------------------------------------

export interface ThemeStatus {
  /** What Settings asks for; null when nothing is selected. */
  requestedSlug: string | null
  /** What is actually rendering. */
  activeSlug: string
  /** True when the requested theme could not be used. */
  fallback: boolean
  reason: FallbackReason | null
}

/**
 * The state of theme selection, for an operator.
 *
 * Presentation-neutral on purpose: no HTML, no copy, no severity. Phase 6.4
 * turns this into a banner ("Theme 'aurora' is selected but is not available in
 * this build") and the Appearance screen; deciding the wording here would put
 * admin concerns in the render path.
 *
 * Carries no internals — no stack traces, no manifest dumps, no raw errors.
 * `requestedSlug` is the one value that came from outside, and 6.4 must escape
 * it like any other untrusted string.
 */
export async function getThemeStatus(): Promise<ThemeStatus> {
  const resolved = await resolveTheme()
  return {
    requestedSlug: resolved.requestedSlug,
    activeSlug: resolved.slug,
    fallback: resolved.didFallBack,
    reason: resolved.reason,
  }
}

// -- Fallback logging ---------------------------------------------------------

/**
 * One warning per distinct fallback state, per process.
 *
 * Theme resolution runs on every public request, so logging unconditionally
 * would emit a line per page view for as long as the misconfiguration lasted —
 * which is the fastest way to make an operator stop reading their logs. Keyed
 * by slug and reason, so a *different* breakage still gets its own line.
 *
 * A plain Set, not a cache: this is per-process state that should reset when
 * the process does, and a restart is exactly when an operator wants to be told
 * again. Bounded in practice by the number of distinct bad slugs, which is one.
 */
const warned = new Set<string>()

/** Exposed for tests, which need each case to log rather than be deduplicated
 *  against a previous one. Not called by application code. */
export function resetFallbackWarnings(): void {
  warned.clear()
}

const REASON_DETAIL: Record<FallbackReason, string> = {
  invalid: "the stored value is not a valid theme slug",
  missing: "no such theme is installed in this build",
  incompatible: "it does not support this version of FlowCMS",
}

async function resolveThemeAndWarn(): Promise<ResolvedTheme> {
  const resolved = await resolveTheme()

  if (resolved.didFallBack && resolved.reason) {
    const key = `${resolved.requestedSlug}:${resolved.reason}`
    if (!warned.has(key)) {
      warned.add(key)
      // The requested slug is logged because an operator needs to know which
      // theme is stuck. It is a slug from their own database, and it goes to a
      // server log, not to a page.
      console.warn(
        `[flowcms] Active theme "${resolved.requestedSlug}" is not being used: ` +
          `${REASON_DETAIL[resolved.reason]}. Rendering "${resolved.slug}" instead. ` +
          `The stored selection has been left unchanged.`,
      )
    }
  }

  return resolved
}
