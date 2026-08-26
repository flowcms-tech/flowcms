/**
 * Text extraction over stored post HTML — words, sentences, links, images,
 * headings.
 *
 * Post bodies are TinyMCE output already run through `sanitizePostContent`, so
 * the tag set is a fixed allowlist and any `<` or `>` inside an attribute value
 * has been entity-escaped. That is what makes regex scanning safe here: a real
 * parser would be a runtime dependency, and this module has to run unchanged in
 * the browser (the live editor panel) and on the server (write-time scoring, the
 * audit dashboard). Two implementations of "how long is this post" is exactly
 * what makes an SEO panel untrustworthy, so everything downstream — the
 * analyser, the readability tab, the table of contents — reads its text from
 * here rather than stripping tags for itself.
 */

/** Entities TinyMCE and the sanitizer actually emit, plus the punctuation an
 *  editor gets from smart-quote substitution. Anything not listed is left as
 *  the literal entity: a stray `&pi;` counted as one word is a better failure
 *  than a half-decoded string. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", middot: "·", bull: "•", times: "×",
  copy: "©", reg: "®", trade: "™", deg: "°", euro: "€", pound: "£", cent: "¢",
  eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ocirc: "ô", uuml: "ü",
}

/** Latin letters and digits. Deliberately not `\p{L}` — Unicode property
 *  escapes need an ES2018 regex target and this file compiles under ES2017. */
const WORD_CHAR = /[a-z0-9À-ɏ]/i

/** Trailing `.` that ends one of these is an abbreviation, not a sentence
 *  boundary. Without it every "Mr. Chen" doubles the sentence count, which
 *  drags the Flesch score up by ~10 points on any post that quotes someone. */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "jr", "sr", "st", "ave", "rd", "blvd",
  "e.g", "i.e", "etc", "vs", "inc", "ltd", "co", "no", "approx", "fig",
  "a.m", "p.m", "u.s", "u.k",
])

/** A complete sentence that finishes this close to the excerpt limit beats a
 *  longer fragment with an ellipsis glued on. */
const SENTENCE_SNAP_WINDOW = 40

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body.charAt(0) === "#") {
      const code = body.charAt(1).toLowerCase() === "x"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
      // Out-of-range code points make fromCodePoint throw, and this runs inside
      // a save handler — an undecoded entity is never worth a 500.
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })
}

/**
 * Tags out, entities in, whitespace collapsed. Tags are replaced with a space
 * rather than removed, so `<p>one</p><p>two</p>` is two words and not "onetwo".
 * Entities are decoded *after* the tag strip so `&lt;p&gt;` in a code sample
 * stays text instead of turning into markup we then delete.
 */
export function stripHtml(html: string): string {
  if (!html) return ""
  return decodeEntities(
    html
      // The sanitizer drops these outright; this only matters for callers
      // analysing unsaved editor content, where the raw string is whatever the
      // author just pasted in.
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]*>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Words as a human would count them. Tokens with no letter or digit ("—", "|",
 * "•") are punctuation, and counting them inflates reading time and deflates
 * keyword density at the same time.
 */
export function countWords(html: string): number {
  const text = stripHtml(html)
  if (!text) return 0
  return text.split(/\s+/).filter((token) => WORD_CHAR.test(token)).length
}

/** Re-exported from the theme contract, where it moved in Phase 7.2 so the
 *  published `flowcms` package could carry it without carrying this analyser.
 *  Kept reachable from here because the SEO panel reads it alongside
 *  `countWords`. */
export { readingTimeMinutes } from "@/Themes/contract/runtime/readingTime"

/** Index just past each sentence-terminating punctuation run. */
function findSentenceEnds(text: string): number[] {
  const ends: number[] = []
  // Requiring whitespace or end-of-string after the punctuation is what keeps
  // "$149.99" and "3.5 mm" from being read as two sentences each — a technical
  // blog quotes prices constantly.
  const pattern = /[.!?…]+["'’”)\]]*(?=\s|$)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (!endsWithAbbreviation(text, match.index)) ends.push(match.index + match[0].length)
  }
  return ends
}

function endsWithAbbreviation(text: string, punctuationIndex: number): boolean {
  if (text.charAt(punctuationIndex) !== ".") return false
  let start = punctuationIndex
  while (start > 0 && /[A-Za-z.]/.test(text.charAt(start - 1))) start -= 1
  return ABBREVIATIONS.has(text.slice(start, punctuationIndex).toLowerCase())
}

/**
 * Sentence split for the readability metrics. Approximate by construction —
 * it has no grammar, only punctuation plus the abbreviation list above — which
 * is why the UI labels the Flesch score "approximate" rather than showing a
 * decimal it cannot defend.
 */
export function splitSentences(text: string): string[] {
  const ends = findSentenceEnds(text)
  const sentences: string[] = []
  let start = 0
  for (const end of ends) {
    sentences.push(text.slice(start, end).trim())
    start = end
  }
  sentences.push(text.slice(start).trim())
  return sentences.filter((sentence) => WORD_CHAR.test(sentence))
}

/**
 * First complete sentences of the body, up to `maxLength`.
 *
 * Cuts at a sentence boundary whenever one lands within 40 characters of the
 * limit, otherwise at a word boundary with an ellipsis. The ellipsis appears
 * *only* on the mid-sentence cut: an excerpt that happens to end where the
 * author's sentence ended is a finished thought, and trailing dots on it read
 * as truncation that isn't there.
 */
export function generateExcerpt(html: string, maxLength = 155): string {
  const text = stripHtml(html)
  if (text.length <= maxLength) return text

  let sentenceEnd = 0
  for (const end of findSentenceEnds(text)) {
    if (end > maxLength) break
    sentenceEnd = end
  }
  if (sentenceEnd >= maxLength - SENTENCE_SNAP_WINDOW) return text.slice(0, sentenceEnd).trim()

  const window = text.slice(0, maxLength)
  const lastSpace = window.lastIndexOf(" ")
  const clipped = lastSpace > 0 ? window.slice(0, lastSpace) : window
  // Dangling punctuation before an ellipsis ("the deadbolt, …") reads as a
  // typo, so strip whatever the word-boundary cut left behind.
  return `${clipped.replace(/[\s,;:.!?"'‘’“”(\[-]+$/, "")}…`
}

/** Reads one attribute out of an already-matched tag's attribute string.
 *  The leading `(?:^|[\s/])` matters: a bare `\bid\s*=` also matches the `id`
 *  inside `data-id="…"`, which would hand the TOC builder a nonsense anchor. */
function readAttribute(attributes: string, name: string): string | null {
  const pattern = new RegExp(`(?:^|[\\s/])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i")
  const match = attributes.match(pattern)
  if (!match) return null
  return decodeEntities(match[1] ?? match[2] ?? match[3] ?? "")
}

export interface ExtractedLink {
  href: string
  text: string
  rel: string | null
  target: string | null
}

export function extractLinks(html: string): ExtractedLink[] {
  const links: ExtractedLink[] = []
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const href = readAttribute(match[1], "href")
    // An anchor with no href is a bookmark target, not a link. Counting it as
    // an internal link would let a post pass the internal-link check with none.
    if (!href) continue
    links.push({
      href,
      text: stripHtml(match[2]),
      rel: readAttribute(match[1], "rel"),
      target: readAttribute(match[1], "target"),
    })
  }
  return links
}

export interface ExtractedImage {
  src: string
  /** `null` when the attribute is absent, `""` when it is present but empty.
   *  Callers that judge accessibility must treat both as missing — `alt=""` is
   *  a decorative marker, and nothing the editor inserts is decorative. */
  alt: string | null
}

export function extractImages(html: string): ExtractedImage[] {
  const images: ExtractedImage[] = []
  const pattern = /<img\b([^>]*?)\/?>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const src = readAttribute(match[1], "src")
    if (!src) continue
    images.push({ src, alt: readAttribute(match[1], "alt") })
  }
  return images
}

export interface ExtractedHeading {
  level: number
  text: string
  id: string | null
}

/** Document-order h1–h6 with their text and any hand-authored `id`. Flat, not
 *  nested: the analyser wants "did an h3 appear before an h2", which a tree has
 *  already thrown away. `buildTableOfContents` does the nesting. */
export function extractHeadingsFlat(html: string): ExtractedHeading[] {
  const headings: ExtractedHeading[] = []
  const pattern = /<(h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    headings.push({
      level: Number(match[1].charAt(1)),
      text: stripHtml(match[3]),
      id: readAttribute(match[2], "id"),
    })
  }
  return headings
}

/**
 * The repo's slug rules, reimplemented here rather than imported.
 *
 * Every module has its own copy in a `Values/*.tsx` that pulls in React for the
 * table columns beside it; importing one of those would drag React into the
 * analyser and break the "runs on the server, runs in the browser, imports
 * nothing" contract this whole file exists to keep. Behaviour must stay
 * identical to `slugify` in BlogPostValues.tsx — the keyword-in-slug check and
 * the TOC anchors both compare against slugs that file produced.
 */
export function slugifyText(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
