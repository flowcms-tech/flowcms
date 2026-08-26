/**
 * Renders the `%variable%` meta templates from settings.
 *
 * Shared by `buildPostMetadata` on the server and the SERP snippet preview in
 * the browser, which is the entire point: the preview claims to show the tag
 * the page will emit, and a second implementation would eventually make that a
 * lie. Per-post `metaTitle` / `metaDescription` always win — the template only
 * fills blanks, and the caller decides that before calling here.
 */

export interface MetaTemplateVars {
  title?: string
  sitename?: string
  sep?: string
  excerpt?: string
  category?: string
  primary_category?: string
  tag?: string
  author?: string
  date?: string
  modified?: string
  focus_keyword?: string
  /** "2" on `/blog?page=2`. What makes paginated archive titles unique, which
   *  is what keeps them out of the duplicate-content bucket (spec §5.9). */
  page?: string
}

/** Punctuation that only exists to sit *between* two things. Left stranded by
 *  an empty variable it becomes visible breakage — "Emergency Rekeying |" is
 *  the classic Rank Math misconfiguration, live on the result page. */
const SEPARATOR_TOKENS = new Set(["|", "-", "–", "—", "·", "•", ":", "~", "/", "»", "«", ">", "<", "*", "+"])

const VARIABLE_PATTERN = /%([a-z_][a-z0-9_]*)%/gi

export function renderMetaTemplate(template: string, vars: MetaTemplateVars): string {
  if (!template) return ""

  const resolved = template.replace(VARIABLE_PATTERN, (_match, name: string) => {
    const key = name.toLowerCase() as keyof MetaTemplateVars
    // Unknown and unset resolve the same way: to nothing. A literal `%foo%` on
    // a live page is worse than a slightly short title, and the cleanup below
    // is what stops "nothing" from leaving a hole in the string.
    if (key === "sep") {
      // The settings column defaults to "|", so a caller that has no separator
      // configured still gets the separator the template was written for
      // rather than two variables run together.
      return vars.sep ?? "|"
    }
    return (vars[key] ?? "").toString()
  })

  return tidy(resolved, vars.sep)
}

/**
 * Removes what an empty variable leaves behind: doubled spaces, separators with
 * nothing on one side of them, doubled separators, empty brackets, and trailing
 * commas. Whitespace-token based rather than a pile of regexes over the whole
 * string, so a hyphen inside "How-to" is never mistaken for a separator — only
 * a separator standing alone between spaces is one.
 */
function tidy(text: string, sep: string | undefined): string {
  const separators = new Set(SEPARATOR_TOKENS)
  // A configured separator that is punctuation ("»") joins the set; one that is
  // a word ("by", "at") deliberately does not — stripping it would eat content.
  if (sep && !/[a-z0-9]/i.test(sep)) separators.add(sep)

  const tokens = text
    // "(%category%)" with no category leaves "()" glued to whatever punctuation
    // followed it, so empty brackets go before the token pass rather than after.
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  const kept: string[] = []
  for (const token of tokens) {
    if (!separators.has(token)) {
      kept.push(token)
      continue
    }
    // Drop a leading separator, and collapse a run of them to one. A trailing
    // separator is dropped after the loop, once we know nothing follows.
    if (kept.length === 0) continue
    if (separators.has(kept[kept.length - 1])) continue
    // "%title%, %category% %sep% %sitename%" with no category strands a comma
    // against the separator: "Rekeying a lock, | FlowCMS".
    kept[kept.length - 1] = kept[kept.length - 1].replace(/[,;:]+$/, "")
    kept.push(token)
  }
  while (kept.length > 0 && separators.has(kept[kept.length - 1])) kept.pop()

  return kept
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,;:.!?])/g, "$1")
    .replace(/([,;:])(?=\s*[,;:])/g, "")
    .replace(/[\s,;:]+$/g, "")
    .replace(/^[\s,;:]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}
