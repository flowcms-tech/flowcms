import {
  RESERVED_EXACT_PATHS,
  RESERVED_FIRST_SEGMENTS,
} from "@/Framework/Functions/reservedPaths"

/**
 * Admin path rules, as pure functions.
 *
 * This module reads no environment and imports nothing server-only, so it is
 * safe inside a client bundle, safe inside the proxy bundle, and directly
 * unit-testable. `adminPath.ts` is the thin server wrapper that supplies
 * `process.env`.
 *
 * The split exists because three very different callers need the same rules:
 * the proxy (which must not import `server-only`), React client components
 * (which must not read `process.env` at all), and ordinary server code. Putting
 * the logic anywhere else means at least one of them reimplements it.
 */

/** Where the App Router files actually live. Never shown to a browser. */
export const INTERNAL_ADMIN_PATH = "/admin-panel"

/** Public default when FLOWCMS_ADMIN_PATH is unset. */
export const DEFAULT_ADMIN_PATH = "/admin"

export type AdminPathValidation =
  | { ok: true; value: string }
  | { ok: false; reason: string }

/** Characters allowed in a path segment: RFC 3986 unreserved, plus underscore. */
const SEGMENT_PATTERN = /^[A-Za-z0-9_.~-]+$/

/**
 * Segments an admin path may not claim.
 *
 * Derived from `reservedPaths.ts` rather than duplicated, so a future top-level
 * route added there is automatically refused here too. `_next`, `favicon.ico`
 * and `robots.txt` are Next's own and are not in that list because nothing can
 * create a custom page at them anyway.
 */
const RESERVED_SEGMENTS: readonly string[] = [
  ...RESERVED_FIRST_SEGMENTS,
  "_next",
  "favicon.ico",
  "robots.txt",
]

function reject(reason: string): AdminPathValidation {
  return { ok: false, reason }
}

/**
 * Normalize and validate a candidate public admin path.
 *
 * Normalization is deliberately generous about what an operator gets wrong
 * harmlessly — a missing leading slash, a trailing slash, surrounding
 * whitespace, a doubled separator. It is deliberately unforgiving about
 * everything else: a value containing traversal, a query string, or a backslash
 * is not a typo to be repaired, it is a string whose intent cannot be guessed,
 * and guessing at the location of an admin panel is how one ends up served
 * somewhere nobody expected.
 */
export function validateAdminPath(input: unknown): AdminPathValidation {
  if (typeof input !== "string") {
    return reject(`expected a string, received ${input === null ? "null" : typeof input}`)
  }

  const trimmed = input.trim()
  if (trimmed === "") return reject("value is empty")

  // Checked before normalization: each of these changes what the path means, so
  // repairing around them would be repairing a different string than the one
  // the operator wrote.
  if (trimmed.includes("?")) return reject("must not contain a query string")
  if (trimmed.includes("#")) return reject("must not contain a fragment")
  if (trimmed.includes("\\")) return reject("must not contain a backslash")
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return reject("must not contain control characters")
  if (/\s/.test(trimmed)) return reject("must not contain whitespace")
  if (/%2e|%2f|%5c/i.test(trimmed)) {
    return reject("must not contain percent-encoded dots or path separators")
  }

  const segments = trimmed.split("/").filter((segment) => segment !== "")
  if (segments.length === 0) return reject("must not be the site root")

  for (const segment of segments) {
    if (segment === "." || segment === "..") return reject("must not contain path traversal")
    if (!SEGMENT_PATTERN.test(segment)) {
      return reject(`segment "${segment}" contains characters that are not allowed in a path`)
    }
  }

  const value = `/${segments.join("/")}`

  if ((RESERVED_EXACT_PATHS as readonly string[]).includes(value)) {
    return reject(`"${value}" is a reserved FlowCMS route`)
  }
  if (RESERVED_SEGMENTS.includes(segments[0])) {
    return reject(`"/${segments[0]}" is a reserved FlowCMS route`)
  }

  return { ok: true, value }
}

/**
 * Resolve the configured public admin path, or throw.
 *
 * Unset and blank both mean "the operator expressed no preference" and yield
 * the default — an empty environment variable is indistinguishable from an
 * absent one in every deployment tool worth naming, so treating blank as fatal
 * would fail deployments over a non-choice.
 *
 * Any other invalid value throws. Falling back would leave a misconfigured
 * install serving traffic while the operator believes their chosen path is in
 * effect; for this particular setting, doing something other than what was
 * asked is worse than not starting.
 */
export function resolveAdminPathFrom(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") return DEFAULT_ADMIN_PATH

  const result = validateAdminPath(raw)
  if (!result.ok) {
    throw new Error(
      `Invalid FLOWCMS_ADMIN_PATH: ${JSON.stringify(raw)} — ${result.reason}. ` +
        `Choose a path that does not collide with a FlowCMS route (` +
        `${RESERVED_SEGMENTS.map((segment) => `/${segment}`).join(", ")}).`,
    )
  }
  return result.value
}

/** How a request relates to the admin panel. */
export type RequestClass = "admin" | "internal" | "public"

function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.replace(/\/+$/, "") : path
}

/**
 * Join an admin root and a sub-path into exactly one well-formed path.
 *
 * Centralized because the failure mode of hand-concatenation is `/admin//blog`,
 * which resolves to a different route than `/admin/blog` and produces a 404
 * that reads as a routing bug rather than a string bug.
 */
export function joinAdminPath(root: string, sub?: string): string {
  const base = stripTrailingSlash(root.startsWith("/") ? root : `/${root}`)
  if (sub === undefined || sub === "" || sub === "/") return base

  const [rawPath, ...queryParts] = sub.split("?")
  const query = queryParts.length > 0 ? `?${queryParts.join("?")}` : ""
  const segments = rawPath.split("/").filter((segment) => segment !== "")
  if (segments.length === 0) return `${base}${query}`

  return `${base}/${segments.join("/")}${query}`
}

/**
 * True when `pathname` is `prefix` or sits beneath it.
 *
 * The `/` in the second comparison is the entire point: a bare
 * `startsWith(prefix)` would classify a public page at `/admin-notes` as part
 * of an `/admin` panel and rewrite it into the dashboard.
 */
function isWithin(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/**
 * Classify a request path.
 *
 * Pure, allocation-light, and the first thing the proxy does on every matched
 * request — a blog post must not pay for the admin panel's existence beyond
 * this comparison.
 */
export function classifyRequestPath(pathname: string, publicAdminPath: string): RequestClass {
  if (isWithin(pathname, publicAdminPath)) return "admin"
  if (isWithin(pathname, INTERNAL_ADMIN_PATH)) return "internal"
  return "public"
}

/** Rewrite target: the public admin prefix replaced by the internal one. */
export function toInternalAdminPath(pathname: string, publicAdminPath: string): string {
  const rest = pathname.slice(publicAdminPath.length)
  return joinAdminPath(INTERNAL_ADMIN_PATH, rest)
}
