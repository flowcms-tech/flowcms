/**
 * Turning what a menu item stores into an href a theme can render.
 *
 * DEPENDENCY-FREE AND PURE, like `Framework/Auth/permissions.ts` and
 * `Framework/Activity/activityTypes.ts`. The admin form validates a custom
 * target in the browser with the same function the API validates it with and
 * the same function the public render path trusts — one rule, three places, no
 * possibility of the client being more permissive than the server.
 *
 * WHY AN ALLOWLIST
 *
 * A menu target ends up in an `href` that a theme renders without re-checking
 * it. Blocking `javascript:` and `data:` would be a list of the schemes
 * somebody thought of on the day; `vbscript:`, `blob:` and whatever ships next
 * are not on it. So exactly two shapes are accepted — a site-relative path, or
 * an http/https URL — and everything else is refused without being named.
 *
 * `mailto:` and `tel:` are deliberately NOT accepted in v0.1. They are
 * legitimate and they are also a separate decision (a mailto address in a
 * public menu is harvested within the hour); adding them later is additive,
 * removing them later would break operators' menus.
 */

/** Longer than any legitimate link and short enough to bound what is stored. */
const MAX_TARGET_LENGTH = 2048

/**
 * Whether the value contains a C0 control character or DEL.
 *
 * A loop over code points rather than a regexp: the equivalent character class
 * is written with escapes that are easy to corrupt when a file is edited by a
 * tool, and a corrupted character class fails OPEN — it would still compile,
 * still pass a casual read, and quietly stop rejecting anything.
 *
 * The check matters because browsers strip tabs and newlines out of URLs before
 * resolving them, so `java<TAB>script:alert(1)` navigates to a `javascript:`
 * URL while matching no naive scheme test. Refusing control characters outright
 * removes the whole technique rather than the one example of it.
 */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * Validate a `custom` menu target, returning the value to store and render, or
 * null if it is not something FlowCMS will put in an href.
 *
 * Returns the NORMALISED value (trimmed; an http/https URL as the URL parser
 * serialises it) so that what is validated is exactly what is stored.
 */
export function sanitizeCustomTarget(value: string): string | null {
  if (typeof value !== "string") return null

  const trimmed = value.trim()
  if (trimmed === "") return null
  if (trimmed.length > MAX_TARGET_LENGTH) return null
  if (hasControlCharacter(trimmed)) return null

  if (trimmed.startsWith("/")) {
    // `//host` is protocol-relative — an off-site link wearing a path's
    // clothes. `/\host` is the same thing: several browsers normalise the
    // backslash to a slash before resolving.
    if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return null

    // Parsed against a throwaway base purely to reject anything the URL parser
    // cannot make sense of. The ORIGINAL string is returned, not the parser's
    // rewrite, because a path is stored and rendered as the operator typed it.
    try {
      new URL(trimmed, "https://flowcms.invalid")
    } catch {
      return null
    }
    return trimmed
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    // No scheme and no leading slash: `example.com/path` and `about/us` both
    // land here. Neither is refused for being wrong so much as for being
    // ambiguous — one is an off-site link the operator did not mark as one, the
    // other resolves differently depending on the page it appears on.
    return null
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null

  return url.toString()
}

/** The public URL of a published blog post. */
export function postHref(slug: string): string {
  return `/blog/${slug}`
}

/** The public URL of a category or tag archive. */
export function taxonomyHref(kind: "category" | "tag", slug: string): string {
  return `/blog/${kind}/${slug}`
}

/**
 * The public URL of a custom page.
 *
 * A custom page's `path` column IS its URL — it is validated and made unique on
 * write — so this is a pass-through with one guard. The guard exists because a
 * row edited by hand could otherwise turn an internal menu entry into an
 * off-site link, and the menu layer is not the place to discover that.
 */
export function pageHref(path: string): string | null {
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return null
  if (hasControlCharacter(path)) return null
  return path
}
