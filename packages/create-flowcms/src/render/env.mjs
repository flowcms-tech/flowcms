/**
 * Turning configuration into a `.env` file.
 *
 * THE REASON THIS IS NOT `${key}=${value}`
 *
 * A dotenv file is parsed line by line. A value containing a newline is not a
 * malformed value — it is a second line, and a second line is a second variable
 * that nobody wrote. An operator pasting an S3 secret with a trailing newline,
 * or a database URL from a provider's console with a stray carriage return,
 * silently gains a variable whose name is whatever followed it.
 *
 * So values are quoted where quoting is needed, and REFUSED where they cannot
 * be represented. Refusing is right rather than escaping: there is no FlowCMS
 * configuration value that legitimately contains a newline or a control
 * character, so a value that has one is a mistake to report, not a string to
 * repair.
 */

const CONTROL_CHARACTERS = new RegExp("[\\u0000-\\u001f\\u007f]")

/** Values needing quotes: anything a dotenv parser would read differently bare. */
const NEEDS_QUOTES = /[\s#'"$`\\]/

export class EnvValueError extends Error {
  constructor(key, reason) {
    // The KEY, never the value. An error message quoting a rejected secret puts
    // it in a terminal, a scrollback buffer and a support ticket.
    super(`Cannot write ${key}: ${reason}`)
    this.name = "EnvValueError"
    this.key = key
  }
}

/**
 * One `KEY=value` line.
 *
 * Double quotes with backslash escaping, which is what every dotenv
 * implementation agrees on. Single quotes would be simpler but cannot contain a
 * single quote, and a generated password can.
 */
export function serializeEnvValue(key, value) {
  if (value === null || value === undefined) return null
  const text = String(value)

  if (CONTROL_CHARACTERS.test(text)) {
    throw new EnvValueError(key, "the value contains a newline or control character")
  }

  if (text === "") return `${key}=`
  if (!NEEDS_QUOTES.test(text)) return `${key}=${text}`

  const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$")
  return `${key}="${escaped}"`
}

/**
 * A whole file, from an ordered list of sections.
 *
 * Ordered and sectioned rather than alphabetical: this file is read by a person
 * trying to change one thing, and grouping by concern is what makes it possible
 * to find. An entry whose value is null is omitted entirely — an empty
 * `REDIS_URL=` and an absent one mean the same thing to the application, and
 * the absent one does not look like a setting somebody cleared.
 */
export function serializeEnvFile(sections) {
  const lines = []

  for (const section of sections) {
    const entries = section.entries
      .map(([key, value]) => serializeEnvValue(key, value))
      .filter((line) => line !== null)

    if (entries.length === 0) continue

    if (lines.length > 0) lines.push("")
    if (section.title) lines.push(`# --- ${section.title} ${"-".repeat(Math.max(0, 72 - section.title.length))}`)
    for (const note of section.notes ?? []) lines.push(`# ${note}`)
    lines.push(...entries)
  }

  return `${lines.join("\n")}\n`
}

/**
 * The header a generated `.env` opens with.
 *
 * It says the two things an operator needs to know before editing: that the
 * secrets in here are real, and that this file is theirs rather than something
 * the installer will come back and rewrite.
 */
export const ENV_HEADER = [
  "# FlowCMS deployment configuration",
  "#",
  "# Written by create-flowcms. THIS FILE CONTAINS REAL SECRETS — it is ignored",
  "# by git, and it should never be committed, pasted into an issue, or copied",
  "# to another installation.",
  "#",
  "# It is yours now. create-flowcms does not read it back and will not rewrite",
  "# it; change anything here and restart. `.env.example` documents every",
  "# variable, including the optional ones this file leaves out.",
  "",
]
