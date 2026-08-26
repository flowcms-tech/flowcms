/**
 * Turning an `href` out of post content into something this site can resolve.
 *
 * Pure, and in `Values/` with the other analysers, because two consumers need
 * it and they cannot share code any other way: `LinkChecker` is `server-only`
 * and imports the DB, while the SEO audit's issue builder has to stay
 * dependency-free so the same rules run in the browser and on the server. One
 * of them reimplementing "is this link internal" is how an audit ends up
 * disagreeing with a link scan about the same link.
 */

/** Origin, lowercased. Empty string when `baseUrl` is unparseable, which makes
 *  every absolute URL external rather than throwing on a misconfigured
 *  setting. */
function originOf(baseUrl: string | undefined): string {
  if (!baseUrl) return ""
  try {
    return new URL(baseUrl).origin.toLowerCase()
  } catch {
    return ""
  }
}

/**
 * The site-relative path an href points at, or `null` when it points somewhere
 * else (another host, `mailto:`, a bare fragment).
 *
 * Query strings and fragments are dropped: neither changes which route answers,
 * and keeping them would report one page as three separate links.
 */
export function toInternalPath(href: string, baseUrl: string | undefined): string | null {
  const trimmed = href.trim()
  if (!trimmed || trimmed.startsWith("#")) return null
  if (/^(mailto:|tel:|sms:|javascript:|data:)/i.test(trimmed)) return null
  if (trimmed.startsWith("//")) return null // protocol-relative — another host

  let path: string
  if (trimmed.startsWith("/")) {
    path = trimmed
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    const origin = originOf(baseUrl)
    if (!origin) return null
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      return null
    }
    if (parsed.origin.toLowerCase() !== origin) return null
    path = parsed.pathname
  } else {
    // "guide", "./guide" — post content is authored against the site root, so
    // treat it as root-relative rather than guessing a base.
    path = `/${trimmed.replace(/^\.\//, "")}`
  }

  path = path.split("?")[0].split("#")[0]
  try {
    path = decodeURIComponent(path)
  } catch {
    // A malformed escape sequence is not worth failing a whole scan over.
  }
  if (path.length > 1) path = path.replace(/\/+$/, "")
  return path || "/"
}

/**
 * The post slug an internal path addresses, or `null` for anything else.
 *
 * Archive paths (`/blog/category/x`, `/blog/tag/x`, `/blog/author/x`) return
 * `null` on purpose — a link to a category is not an inbound link to a post,
 * and counting it as one would make orphan detection silently useless on any
 * site whose posts all link their own category.
 */
export function internalPostSlug(path: string | null): string | null {
  if (!path) return null
  const segments = path.toLowerCase().split("/").filter(Boolean)
  if (segments.length !== 2 || segments[0] !== "blog") return null
  if (["category", "tag", "author"].includes(segments[1])) return null
  return segments[1]
}
