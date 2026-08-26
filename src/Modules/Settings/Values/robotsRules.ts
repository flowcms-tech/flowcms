/**
 * Parser for the "extra robots.txt rules" settings field.
 *
 * Pure and dependency-free on purpose: the admin form runs it in the browser
 * for the live preview and the validation schema, and `robots.ts` runs the
 * identical function on the server to build the real file. Two parsers would
 * eventually disagree, and the disagreement would only show up as a crawl
 * problem nobody notices for weeks.
 *
 * The field is deliberately *extra* rules, not a whole-file override — the
 * generated core rules always emit. A textarea that replaces robots.txt
 * wholesale is one typo away from `Disallow: /`, with no undo and a failure
 * mode that is both slow and silent.
 */

export interface RobotsRule {
  /** Canonicalised directive name, e.g. "Disallow". */
  directive: string
  value: string
}

export interface ParsedRobotsRules {
  rules: RobotsRule[]
  errors: string[]
}

/** Only path-scoped directives. `User-agent` is excluded because these lines
 *  are appended to the single generated `User-agent: *` group — letting an
 *  admin open a new group here would silently reparent every rule after it. */
const ALLOWED_DIRECTIVES: Record<string, string> = {
  allow: "Allow",
  disallow: "Disallow",
  "crawl-delay": "Crawl-delay",
}

export function parseRobotsRules(raw: string): ParsedRobotsRules {
  const rules: RobotsRule[] = []
  const errors: string[] = []

  const lines = (raw ?? "").split(/\r?\n/)

  lines.forEach((line, index) => {
    const lineNumber = index + 1
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) return

    const separator = trimmed.indexOf(":")
    if (separator === -1) {
      errors.push(`Line ${lineNumber}: expected "Directive: value", e.g. "Disallow: /private/".`)
      return
    }

    const rawDirective = trimmed.slice(0, separator).trim().toLowerCase()
    const value = trimmed.slice(separator + 1).trim()
    const directive = ALLOWED_DIRECTIVES[rawDirective]

    if (!directive) {
      errors.push(
        `Line ${lineNumber}: "${trimmed.slice(0, separator).trim()}" is not an allowed directive — use Allow, Disallow, or Crawl-delay.`
      )
      return
    }

    if (!value) {
      errors.push(`Line ${lineNumber}: ${directive} needs a value.`)
      return
    }

    // The whole reason this parser exists. A single "Disallow: /" de-indexes
    // the entire site, and because search engines drop pages gradually the
    // owner finds out weeks later from missing traffic, not from an error.
    // Blocking one path is a decision; blocking everything is always a typo.
    if (directive === "Disallow" && value === "/") {
      errors.push(
        `Line ${lineNumber}: "Disallow: /" blocks the entire site from every search engine. If you really want that, take the site down instead.`
      )
      return
    }

    if (directive === "Crawl-delay" && !/^\d+(\.\d+)?$/.test(value)) {
      errors.push(`Line ${lineNumber}: Crawl-delay must be a number of seconds.`)
      return
    }

    if (directive !== "Crawl-delay" && !value.startsWith("/") && value !== "*") {
      errors.push(`Line ${lineNumber}: ${directive} paths must start with "/".`)
      return
    }

    rules.push({ directive, value })
  })

  return { rules, errors }
}

export interface ParsedRobotsSitemaps {
  sitemaps: string[]
  errors: string[]
}

/**
 * Extra `Sitemap:` lines, one URL per line.
 *
 * Absolute only. robots.txt defines `Sitemap` as taking a full URL and
 * crawlers ignore a relative one outright — so a relative entry here would
 * look saved, look correct in the file, and do nothing.
 */
export function parseRobotsSitemaps(raw: string): ParsedRobotsSitemaps {
  const sitemaps: string[] = []
  const errors: string[] = []
  const seen = new Set<string>()

  ;(raw ?? "").split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1
    let trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) return

    // Tolerate a pasted "Sitemap: https://…" line. The label is redundant in
    // this field, but rejecting it would be pedantry.
    const labelled = trimmed.match(/^sitemap\s*:\s*(.+)$/i)
    if (labelled) trimmed = labelled[1].trim()

    if (!/^https?:\/\/\S+$/i.test(trimmed)) {
      errors.push(`Line ${lineNumber}: must be a full http:// or https:// URL.`)
      return
    }
    if (seen.has(trimmed)) return
    seen.add(trimmed)
    sitemaps.push(trimmed)
  })

  return { sitemaps, errors }
}

/**
 * The generated core rules, which always emit and always win.
 *
 * They live here rather than inline in `robots.ts` so the admin preview can
 * render the file byte-for-byte instead of approximating it — a preview that
 * omits the core block teaches the owner the wrong mental model of what their
 * extra lines are being added to.
 *
 * The image route MUST stay crawlable: it serves every OG and JSON-LD image,
 * and a blocked image URL makes structured data fail validation and keeps the
 * post out of Google Images. Crawlers resolve by longest match, so this
 * specific Allow beats the broader `/api/` Disallow.
 */
export const CORE_ROBOTS_ALLOW: readonly string[] = ["/", "/api/public/images/"]

/**
 * The admin panel is excluded by its CONFIGURED public path, not by the
 * internal route. Emitting `/admin-panel` here would publish an implementation
 * detail to every crawler while failing to hide the panel anyone can actually
 * reach — precisely backwards.
 *
 * It does mean the configured path appears in a world-readable file, so the
 * obscurity is partial by design. That is accepted: robots.txt was never the
 * access control, authentication is. An operator who would rather not advertise
 * it can remove the rule in Settings.
 *
 * The rest of /api is machine-only.
 *
 * @param adminRoot The configured public admin path.
 */
export function coreRobotsDisallow(adminRoot: string): readonly string[] {
  return [adminRoot, "/api/"]
}

export interface RobotsPreviewInput {
  /** The configured public admin path, so the preview shows the same
   *  Disallow line the served robots.txt will carry. */
  adminRoot: string
  /** The generated sitemap reference, absolute. */
  sitemapUrl: string
  extraRules?: string | null
  extraSitemaps?: string | null
}

/**
 * Renders the exact robots.txt the site will serve — valid lines only.
 *
 * Invalid lines are omitted for the same reason `robots.ts` omits them: the
 * preview has to show what will be served, not what was typed. Call
 * `parseRobotsRules` / `parseRobotsSitemaps` alongside this to surface the
 * errors next to it.
 */
export function buildRobotsPreview({
  sitemapUrl,
  adminRoot,
  extraRules,
  extraSitemaps,
}: RobotsPreviewInput): string {
  const { rules } = parseRobotsRules(extraRules ?? "")
  const { sitemaps } = parseRobotsSitemaps(extraSitemaps ?? "")

  const lines: string[] = ["User-agent: *"]
  for (const path of CORE_ROBOTS_ALLOW) lines.push(`Allow: ${path}`)
  for (const path of coreRobotsDisallow(adminRoot)) lines.push(`Disallow: ${path}`)
  for (const rule of rules) lines.push(`${rule.directive}: ${rule.value}`)

  lines.push("")
  lines.push(`Sitemap: ${sitemapUrl}`)
  for (const url of sitemaps) lines.push(`Sitemap: ${url}`)

  return `${lines.join("\n")}\n`
}
