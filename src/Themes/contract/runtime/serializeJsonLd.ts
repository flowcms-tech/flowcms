/**
 * The one and only way this app turns a JSON-LD graph into the body of a
 * `<script type="application/ld+json">` element.
 *
 * WHY IT EXISTS
 *
 * `JSON.stringify(data)` is not safe to drop inside a `<script>` element. HTML
 * tokenises the script body looking for `</script>` before any JSON parser sees
 * it, so a single user-supplied value -- a page title, a post excerpt, an
 * author bio -- containing `</script><script>...` closes the JSON-LD block
 * early and opens a real one. That is stored XSS on every public page that
 * renders the record, and it needs no more privilege than "may edit a page
 * title".
 *
 * There used to be three call sites and two behaviours: two escaped `<`, one
 * did not, and the one that did not carried a comment claiming it was safe
 * because the *keys* were not user-controlled. The keys were never the risk.
 * Consolidating here is the point of the fix -- a second, subtly different
 * escaper is how this bug comes back.
 *
 * WHAT IT ESCAPES, AND WHY THAT IS LOSSLESS
 *
 * Every replacement produces a JSON `\uXXXX` escape sequence, which parses back
 * to the identical character. `JSON.parse(serializeJsonLd(x))` deep-equals `x`,
 * so search engines read exactly the schema that was intended -- this changes
 * the bytes, never the data.
 *
 *   `<`  the actual break-out character. Nothing else is required to stop
 *        `</script>`, but escaping it alone leaves output whose safety every
 *        future reader has to re-derive.
 *   `>`  paired with `<` so no raw tag syntax survives at all, which makes the
 *        output trivially auditable.
 *   `&`  blocks HTML entity tricks in the parsing modes where they apply.
 *   U+2028 / U+2029  line and paragraph separators: legal inside a JSON string,
 *        but historically line-terminating for JavaScript parsers.
 *
 * The escape sequences are derived from each character's code point rather than
 * written out as literals. That keeps the two invisible line separators out of
 * this source file entirely -- an unprintable line terminator sitting in a
 * string literal is precisely the sort of character that does not survive an
 * editor, a diff, or a copy-paste intact, and a silently mangled escape table
 * here would be a silently reintroduced XSS.
 */

const BACKSLASH = String.fromCharCode(0x5c)
const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

const UNSAFE_CHARS = ["<", ">", "&", LINE_SEPARATOR, PARAGRAPH_SEPARATOR]

/** `<` -> the six characters \ u 0 0 3 c */
function unicodeEscape(char: string): string {
  return BACKSLASH + "u" + char.charCodeAt(0).toString(16).padStart(4, "0")
}

const ESCAPES: Record<string, string> = Object.fromEntries(
  UNSAFE_CHARS.map((char) => [char, unicodeEscape(char)])
)

const UNSAFE_PATTERN = new RegExp(`[${UNSAFE_CHARS.join("")}]`, "g")

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(UNSAFE_PATTERN, (char) => ESCAPES[char])
}
