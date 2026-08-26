import type { InstalledTheme, UnavailableReason } from "@/Themes/registry"
import type { FallbackReason, ThemeStatus } from "@/Themes/resolver"
import { isNoOpActivation } from "@/Themes/constants"

/**
 * The model the Appearance screen renders from, and the serialization boundary
 * between the theme registry and the browser.
 *
 * The registry holds React components and functions. None of that may cross to
 * the client — not because it would leak a secret, but because it cannot be
 * serialized and because a theme's internals are not the admin panel's
 * business. What crosses is metadata an operator reads.
 *
 * PURE. It takes the registry entries and the resolved status as arguments
 * rather than reaching for either, so every operator-visible state — including
 * the ones that only happen after a bad deploy — is constructible in a test.
 *
 * VOCABULARY, which the UI must not blur (see §28 of the phase brief):
 *
 *   requested  — persisted operator intent. What `settings.activeTheme` says.
 *   rendering  — what the public site is actually using right now.
 *   available  — installed in this build AND usable.
 *
 * During a fallback those come apart: the requested theme is not rendering, and
 * the rendering theme was never requested. Labelling both cards "Active" is the
 * confusion this vocabulary exists to prevent.
 */

export interface ThemeCardView {
  slug: string
  name: string
  version: string
  description: string | null
  author: string | null
  authorUrl: string | null
  /** A path inside the theme's own package, or null. Never remote. */
  screenshot: string | null
  /** Informational only in this phase — Menus are Phase 6.5. */
  menuSlots: string[]
  available: boolean
  availabilityReason: UnavailableReason | null
  /** Persisted operator intent points at this theme. */
  requested: boolean
  /** The public site is using this theme right now. */
  rendering: boolean
  /** Whether the Activate action should do anything. Never true for a theme
   *  that is unavailable or already rendering. */
  canActivate: boolean
}

export interface ThemeFallbackView {
  /** Straight from the database, unescaped and unmangled.
   *
   *  Escaping belongs to the renderer — React escapes text children, and the
   *  admin must show what is *actually* stored or the operator cannot fix it.
   *  Anything that reaches this field failed activation validation or predates
   *  it, so it can be arbitrary text. It is never used as a URL, an attribute
   *  or a key. */
  requestedSlug: string
  reason: FallbackReason
  /** The theme rendering instead. */
  activeSlug: string
}

export interface ThemeAdminView {
  themes: ThemeCardView[]
  /** Null in the normal case, including "no selection made". */
  fallback: ThemeFallbackView | null
}

/**
 * Validate a manifest `screenshot` down to a bundled relative path, or null.
 *
 * A manifest is theme-author input, and this field ends up in an `<img src>` in
 * an administrator's browser. Three things it must never become:
 *
 *   - a remote URL, which would let a theme phone home from every operator's
 *     admin panel on every page view;
 *   - a `javascript:` or `data:` URL;
 *   - a path that climbs out of the theme's own directory.
 *
 * Rejection is silent and per-field: a bad screenshot drops to null and the
 * theme still lists. Refusing the whole theme over a cosmetic field would hide
 * a working theme because of a broken image.
 */
export function safeScreenshotPath(value: string | undefined): string | null {
  if (!value) return null

  const trimmed = value.trim()
  if (trimmed === "") return null

  // Anything with a scheme, or protocol-relative, is remote by definition.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null
  if (trimmed.startsWith("//")) return null

  // Backslashes are a Windows traversal in disguise and never legitimate here.
  if (trimmed.includes("\\")) return null

  // A LEADING SLASH IS ALLOWED, and Phase 7.2 is why.
  //
  // It used to be refused alongside remote URLs, under "absolute paths escape
  // the package". That conflated two different things: leaving the package and
  // leaving the ORIGIN. Only the second is a risk, and it is already refused
  // above — a scheme and a protocol-relative prefix are what make a URL remote.
  //
  // Refusing "/" also made the field unusable for the only mechanism that
  // actually works. The Appearance screen lives at a configurable admin path,
  // so a page-relative "screenshot.png" resolves under that path and 404s; and
  // a theme installed into node_modules is not served by Next at all. The
  // supported route is a static import, which yields "/_next/static/media/…".
  // Rejecting that is rejecting every screenshot a package theme can have.
  //
  // Traversal stays blocked by the ".." check below, which a leading slash does
  // nothing to weaken.

  // `..` anywhere, not just at the start — `assets/../../secret.png` climbs out
  // just as effectively.
  if (trimmed.split("/").includes("..")) return null

  return trimmed
}

export function buildThemeAdminView(
  installed: InstalledTheme[],
  status: ThemeStatus,
): ThemeAdminView {
  const cards: ThemeCardView[] = installed.map((entry) => {
    // An unavailable entry has no theme object, but it does have a slug — the
    // registry recorded it precisely so the operator can see what broke.
    const manifest = entry.available ? entry.theme.manifest : null

    const requested = status.requestedSlug === entry.slug
    const rendering = status.activeSlug === entry.slug

    return {
      slug: entry.slug,
      name: manifest?.name ?? entry.slug,
      version: manifest?.version ?? "—",
      description: manifest?.description ?? null,
      author: manifest?.author ?? null,
      authorUrl: manifest?.authorUrl ?? null,
      screenshot: safeScreenshotPath(manifest?.screenshot),
      menuSlots: manifest?.menuSlots ?? [],
      available: entry.available,
      availabilityReason: entry.available ? null : entry.reason,
      requested,
      rendering,
      // Offered when activating would actually change the persisted selection,
      // not merely when a different theme is on screen. During a fallback the
      // default IS rendering while the stored intent points elsewhere, and
      // activating the default is a real action there: it clears the stale
      // selection and the warning with it. The API applies the same rule — a
      // disabled button is a courtesy, not a control.
      canActivate: entry.available && !isNoOpActivation(entry.slug, status.requestedSlug),
    }
  })

  // The theme actually rendering goes first — it is the answer to the question
  // an operator opened this page with — then the rest alphabetically, so the
  // order does not shift as themes are activated.
  cards.sort((a, b) => {
    if (a.rendering !== b.rendering) return a.rendering ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return {
    themes: cards,
    fallback:
      status.fallback && status.reason !== null && status.requestedSlug !== null
        ? {
            requestedSlug: status.requestedSlug,
            reason: status.reason,
            activeSlug: status.activeSlug,
          }
        : null,
  }
}
