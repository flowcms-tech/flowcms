import { slugifyText, stripHtml } from "@/Modules/Blog/Posts/Values/contentStats"
import type { TocHeading } from "@/Themes/contract/views"

/**
 * Builds the on-page table of contents and returns the body HTML with anchor
 * ids injected.
 *
 * Parsed on read rather than rewritten on save. Injecting ids at write time
 * would mean a data migration for every existing post and would freeze the
 * stored content against whatever `slugify` looked like on the day it ran;
 * parsing on read is one pass over a string in a server component whose output
 * is already cached.
 *
 * Pure by contract, like the analyser modules — the public post page renders it
 * on the server and the admin preview renders it in the browser.
 */

/** Defined on the theme contract since Phase 7.2 — a theme renders the tree,
 *  so the published package declares its shape. */
export type { TocHeading } from "@/Themes/contract/views"

/** H2 and H3 only. H4+ in a TOC is an outline of an outline, and H1 belongs to
 *  the page template, not the body. */
const TOC_LEVELS = [2, 3]

const HEADING_PATTERN = /<(h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/gi

/** Same `(?:^|[\s/])` guard as the analyser's attribute reader: a bare `\bid=`
 *  also matches `data-id=`, which would make the TOC anchor a link to nothing. */
const ID_ATTRIBUTE = /(?:^|[\s/])id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i

function readId(attributes: string): string | null {
  const match = attributes.match(ID_ATTRIBUTE)
  if (!match) return null
  const value = (match[1] ?? match[2] ?? match[3] ?? "").trim()
  return value || null
}

/**
 * `text` → a unique anchor id.
 *
 * Ids are anchor URLs: people bookmark them, link to them, and Google may
 * surface them as jump-to links. So they have to be derived only from the
 * heading text and its position among duplicates — never from an index that
 * shifts when an unrelated section is added above.
 */
function uniqueId(text: string, used: Set<string>): string {
  // A heading that is only an image or an emoji slugifies to nothing; "section"
  // still gives it a stable, linkable anchor.
  const base = slugifyText(text) || "section"
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let suffix = 2
  while (used.has(`${base}-${suffix}`)) suffix += 1
  const id = `${base}-${suffix}`
  used.add(id)
  return id
}

export function buildTableOfContents(html: string): { html: string; headings: TocHeading[] } {
  if (!html) return { html: "", headings: [] }

  // Every hand-authored id in the document is reserved before a single one is
  // generated. `sanitizePostContent` deliberately allows `id` on h1–h6 for
  // exactly this feature, so an author's anchor must survive — and a generated
  // id that happens to collide with one further down the page would silently
  // break whichever link was written first.
  const used = new Set<string>()
  for (const match of html.matchAll(HEADING_PATTERN)) {
    const existing = readId(match[2])
    if (existing) used.add(existing)
  }

  const headings: TocHeading[] = []
  const rewritten = html.replace(HEADING_PATTERN, (whole, tag: string, attributes: string, inner: string) => {
    const level = Number(tag.charAt(1))
    if (!TOC_LEVELS.includes(level)) return whole

    const text = stripHtml(inner)
    const existing = readId(attributes)
    const id = existing ?? uniqueId(text, used)

    // Headings with no readable text (a bare image) get their id so any
    // existing anchor keeps working, but stay out of the list — a TOC entry
    // with no label is a dead row.
    if (text) headings.push({ id, text, level, children: [] })

    return existing ? whole : `<${tag} id="${id}"${attributes}>${inner}</${tag}>`
  })

  return { html: rewritten, headings: nest(headings) }
}

/** H3s hang off the H2 above them. An H3 that appears before any H2 is
 *  promoted to the top level rather than dropped — malformed heading order is
 *  the analyser's problem to report, not a reason to hide a section. */
function nest(flat: TocHeading[]): TocHeading[] {
  const tree: TocHeading[] = []
  let openH2: TocHeading | null = null

  for (const heading of flat) {
    if (heading.level === 2) {
      openH2 = heading
      tree.push(heading)
    } else if (openH2) {
      openH2.children.push(heading)
    } else {
      tree.push(heading)
    }
  }
  return tree
}

function countHeadings(headings: TocHeading[]): number {
  return headings.reduce((total, heading) => total + 1 + countHeadings(heading.children), 0)
}

/** Below this a TOC is noise — the reader can already see the whole page. */
export const TOC_MIN_HEADINGS = 3

/**
 * Whether this post's headings justify a table of contents.
 *
 * Core policy, not theme styling: `BlogPostView.toc.hasToc` carries the answer
 * and the article's two-column grid depends on it, so the threshold has to be
 * decided once, before any theme is reached. It lived in the TOC component
 * until Phase 6.1, which meant a theme that replaced that component silently
 * changed the page layout rule.
 */
export function shouldRenderToc(headings: TocHeading[]): boolean {
  return countHeadings(headings) >= TOC_MIN_HEADINGS
}
