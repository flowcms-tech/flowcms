/**
 * Admin-path validation, ported from `src/Framework/Config/adminPathCore.ts`.
 *
 * WHY A PORT AND NOT AN IMPORT
 *
 * The rule has to be identical in two places that cannot share a module. The
 * application's copy is TypeScript inside `src/`, which a published CLI can
 * never reach; exporting it from `flowcms` would widen a public npm API with
 * something no theme author needs; and making the CLI depend on the application
 * would undo the independence Phase 7.3 exists to establish.
 *
 * So the CLI carries this, and `tests/scaffolder/adminPathParity.test.ts` drives
 * BOTH implementations over one table of inputs. That is the same arrangement
 * Phase 7.3 used for secret generation, for the same reason: one rule, two
 * runtimes, proven equal in the one place both are reachable.
 *
 * IF YOU CHANGE A RULE HERE, CHANGE IT THERE. The parity test is what makes
 * that instruction enforceable rather than hopeful.
 */

/** Where the App Router files actually live. Never shown to a browser, and
 *  never written into a generated `.env`. */
export const INTERNAL_ADMIN_PATH = "/admin-panel"

/** Public default when FLOWCMS_ADMIN_PATH is unset. */
export const DEFAULT_ADMIN_PATH = "/admin"

/** RFC 3986 unreserved, plus underscore. */
const SEGMENT_PATTERN = /^[A-Za-z0-9_.~-]+$/

/**
 * Kept in step with `src/Framework/Functions/reservedPaths.ts`.
 *
 * `admin-panel` is in this list, which is what makes the internal route
 * unreachable as an operator's choice — the installer does not need a rule of
 * its own for it.
 */
const RESERVED_FIRST_SEGMENTS = ["admin-panel", "api", "blog", "preview", "sitemap"]
const RESERVED_EXACT_PATHS = ["/robots.txt", "/favicon.ico", "/sitemap.xml", "/sitemap-index.xml"]
const RESERVED_SEGMENTS = [...RESERVED_FIRST_SEGMENTS, "_next", "favicon.ico", "robots.txt"]

/**
 * C0 controls and DEL.
 *
 * Built from escapes rather than written as a literal character class: a
 * range of unprintable characters in source is precisely what an editor, a
 * diff or a copy-paste mangles without anyone noticing, and a silently
 * mangled guard is a guard that has stopped guarding. The application's copy
 * writes the same range as `\u0000-\u001f\u007f`; this is the same set.
 */
const CONTROL_CHARACTERS = new RegExp("[\\u0000-\\u001f\\u007f]")

/**
 * @typedef {{ ok: true, value: string }} AdminPathAccepted
 * @typedef {{ ok: false, reason: string }} AdminPathRejected
 * @typedef {AdminPathAccepted | AdminPathRejected} AdminPathValidation
 */

/** @returns {AdminPathRejected} */
function reject(reason) {
  return { ok: false, reason }
}

/**
 * Normalize and validate a candidate public admin path.
 *
 * Generous about what an operator gets wrong harmlessly — a missing leading
 * slash, a trailing slash, surrounding whitespace, a doubled separator.
 * Unforgiving about everything else: a value containing traversal, a query
 * string or a backslash is not a typo to repair, it is a string whose intent
 * cannot be guessed, and guessing at the location of an admin panel is how one
 * ends up served somewhere nobody expected.
 *
 * @param {unknown} input
 * @returns {AdminPathValidation}
 */
export function validateAdminPath(input) {
  if (typeof input !== "string") {
    return reject(`expected a string, received ${input === null ? "null" : typeof input}`)
  }

  const trimmed = input.trim()
  if (trimmed === "") return reject("value is empty")

  // Checked before normalization: each of these changes what the path means.
  if (trimmed.includes("?")) return reject("must not contain a query string")
  if (trimmed.includes("#")) return reject("must not contain a fragment")
  if (trimmed.includes("\\")) return reject("must not contain a backslash")
  if (CONTROL_CHARACTERS.test(trimmed)) return reject("must not contain control characters")
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

  if (RESERVED_EXACT_PATHS.includes(value)) {
    return reject(`"${value}" is a reserved FlowCMS route`)
  }
  if (RESERVED_SEGMENTS.includes(segments[0])) {
    return reject(`"/${segments[0]}" is a reserved FlowCMS route`)
  }

  return /** @type {AdminPathAccepted} */ ({ ok: true, value })
}
