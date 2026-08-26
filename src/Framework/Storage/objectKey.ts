/**
 * Object-key construction for uploads.
 *
 * The File Manager upload route used to build its key as `prefix + file.name` —
 * two attacker-influenced strings concatenated raw. `file.name` in particular is
 * whatever the multipart body says it is; a browser sends the basename, but
 * nothing about the endpoint requires a browser.
 *
 * Two things follow from that:
 *
 *   - A filename may not contribute path structure. Whatever a client sends,
 *     only a basename survives, so an upload always lands inside the prefix the
 *     caller asked for and nowhere else.
 *   - A prefix may contribute path structure, because nested prefixes are a
 *     real feature — but it is validated segment by segment rather than
 *     flattened, so the feature keeps working while `..` does not.
 *
 * Both functions throw on input they cannot make safe. Silently rewriting an
 * unsafe key into a different valid one is worse: the caller believes the write
 * went where they asked, and it did not.
 */

/**
 * Upload ceiling.
 *
 * The route reads the entire body into a Buffer before handing it to S3, so
 * without a limit one request can exhaust the process's memory — no
 * authentication bypass required, just a large file. 50 MB comfortably covers
 * the images, PDFs and short videos the allowlist permits.
 *
 * This is enforced in the handler as well as advertised here, because
 * `Content-Length` is a claim and `File.size` is the measured value.
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/** Longest filename retained; anything beyond is truncated, extension kept. */
const MAX_FILENAME_LENGTH = 200

/** Longest full key accepted, well inside S3's own 1024-byte limit. */
const MAX_KEY_LENGTH = 900

const CONTROL_CHARS = new RegExp(
  "[\u0000-\u001f\u007f-\u009f]",
  "g"
)

/**
 * Characters that are legal in an S3 key but make the resulting object awkward
 * or ambiguous to serve over HTTP: `%` breaks percent-decoding round trips,
 * `?` and `#` terminate the path, quotes and angle brackets end up in headers
 * and HTML, and whitespace produces keys that differ only invisibly.
 */
const AWKWARD_CHARS = /[\s?#%&"'<>{}[\]^`|~*]/g

export class UnsafeObjectKeyError extends Error {}

/**
 * Reduces a client-supplied filename to a safe basename.
 *
 * Splits on BOTH separators. A POSIX server does not treat `\` as a separator,
 * but S3 keys are opaque strings and a key containing a backslash is a
 * traversal waiting to happen the moment anything syncs the bucket to a Windows
 * filesystem — so both are stripped here rather than reasoned about later.
 */
export function sanitizeFileName(name: string): string {
  const basename = (name.split(/[/\\]/).pop() ?? "").trim()

  const cleaned = basename
    .replace(CONTROL_CHARS, "")
    .replace(AWKWARD_CHARS, "-")
    .replace(/^[.-]+/, "") // no leading dots or dashes: no hidden files, no "..", no "-rf"
    .trim()

  // The emptiness check has to come AFTER substitution, not before: whitespace
  // is in AWKWARD_CHARS, so a name of "   " would otherwise survive as "---" —
  // a perfectly valid object key that nobody asked for. Anything that reduces
  // to nothing meaningful is rejected rather than invented.
  if (!cleaned || /^[.\-_]+$/.test(cleaned)) {
    throw new UnsafeObjectKeyError("The file name is not usable.")
  }

  if (cleaned.length <= MAX_FILENAME_LENGTH) return cleaned

  // Truncate the stem, never the extension — the extension allowlist and the
  // served Content-Type are both derived from it.
  const dot = cleaned.lastIndexOf(".")
  if (dot <= 0) return cleaned.slice(0, MAX_FILENAME_LENGTH)

  const extension = cleaned.slice(dot)
  const stem = cleaned.slice(0, dot)
  const room = Math.max(1, MAX_FILENAME_LENGTH - extension.length)
  return stem.slice(0, room) + extension
}

/**
 * Validates a destination prefix and normalises it to `a/b/` form.
 *
 * Rejects rather than repairs, because every rejected case is either an attack
 * or a bug — no legitimate File Manager navigation produces `..`, a backslash,
 * a control character, or an empty interior segment.
 */
export function sanitizePrefix(prefix: string): string {
  if (!prefix || prefix === "/") return ""

  if (CONTROL_CHARS.test(prefix)) {
    // `test` on a /g regex is stateful; reset before any later use.
    CONTROL_CHARS.lastIndex = 0
    throw new UnsafeObjectKeyError("The destination folder is not valid.")
  }
  CONTROL_CHARS.lastIndex = 0

  if (prefix.includes("\\")) {
    throw new UnsafeObjectKeyError("The destination folder is not valid.")
  }
  if (prefix.startsWith("/")) {
    throw new UnsafeObjectKeyError("The destination folder must be relative.")
  }

  const withoutTrailing = prefix.replace(/\/+$/, "")
  if (!withoutTrailing) return ""

  const segments = withoutTrailing.split("/")
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new UnsafeObjectKeyError("The destination folder is not valid.")
    }
  }

  return segments.join("/") + "/"
}

/** Sanitises both halves and joins them into the final S3 key. */
export function buildObjectKey(prefix: string, fileName: string): string {
  const key = sanitizePrefix(prefix) + sanitizeFileName(fileName)
  if (key.length > MAX_KEY_LENGTH) {
    throw new UnsafeObjectKeyError("The destination path is too long.")
  }
  return key
}
