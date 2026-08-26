import { stripHtml } from "./contentStats"

/**
 * Turns Search Console query rows into editorial suggestions.
 *
 * Same purity contract as `seoAnalysis` and `readability`: no DOM, no DB, no
 * `next/*`, no dependencies. The per-post Insights tab runs it in the browser;
 * the audit dashboard can run the identical function on the server over every
 * post's query set.
 *
 * **Every output is a suggestion with its evidence attached, never an edit.**
 * The panel says "340 impressions, position 12, no mention on the page" and a
 * human decides whether that is a section worth writing. There is deliberately
 * no generation step here of any kind — an SEO tool that writes the copy
 * produces pages that rank for a while and read like nobody wrote them.
 */

export type ContentGapKind = "striking-distance" | "low-ctr" | "no-mention"

export interface GapQueryRow {
  query: string
  clicks: number
  impressions: number
  /** 0–1, as Google reports it. */
  ctr: number
  position: number
}

export interface ContentGap {
  kind: ContentGapKind
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
  /** Only set on `low-ctr` — the average CTR a result at this position earns,
   *  so the panel can show "1.2 % against about 6 % typical" instead of an
   *  unexplained verdict. */
  expectedCtr: number | null
  /** One line naming what to do. */
  headline: string
  /** The numbers behind it, verbatim, so the suggestion can be argued with. */
  evidence: string
  /** Higher sorts first. Impressions-driven, because that is the size of the
   *  opportunity — not clicks, which measure what already works. */
  priority: number
}

/**
 * Average organic CTR by position — the well-known aggregate curve, rounded.
 * Used only to decide whether a given page is *unusually* under-clicked for
 * where it sits; it is an average across every query type on the web and is
 * not a target. That is why the threshold below is half the curve rather than
 * anything near it.
 */
const CTR_BY_POSITION = [0.28, 0.15, 0.11, 0.08, 0.06, 0.05, 0.04, 0.03, 0.03, 0.025]

/** Below this, the percentages are noise. A query with 6 impressions at
 *  position 11 is not a striking-distance opportunity, it is a rounding error
 *  that would push a real one off the list. */
const MIN_IMPRESSIONS = 25

/** A stricter floor for the CTR rule: CTR over a handful of impressions swings
 *  wildly, and a wrong "your title is bad" is worse than a missed one. */
const MIN_IMPRESSIONS_FOR_CTR = 60

/** Positions 5–20. Above 5 the page already wins the click it is going to win;
 *  past 20 an edit rarely moves it into view on its own. */
const STRIKING_MIN_POSITION = 5
const STRIKING_MAX_POSITION = 20

/** Under half the positional average is the line. Anything looser flags normal
 *  variance as a problem. */
const CTR_SHORTFALL_RATIO = 0.5

/** Terms too common to prove anything by their presence or absence. Kept short
 *  on purpose — an aggressive stoplist silently drops the noun that was the
 *  actual gap. */
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does",
  "for", "from", "get", "has", "have", "how", "i", "in", "is", "it", "its",
  "me", "my", "near", "not", "of", "on", "or", "should", "so", "that", "the",
  "their", "there", "these", "they", "this", "to", "up", "was", "we", "what",
  "when", "where", "which", "who", "why", "will", "with", "you", "your",
])

export function expectedCtrForPosition(position: number): number {
  if (position < 1) return CTR_BY_POSITION[0]
  const index = Math.min(CTR_BY_POSITION.length, Math.round(position)) - 1
  return CTR_BY_POSITION[index] ?? CTR_BY_POSITION[CTR_BY_POSITION.length - 1]
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)} %`
}

/** Content words of a query, lowercased. Short tokens go too: "ac" and "id"
 *  match inside half the words on any page. */
function contentTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9à-ɏ]+/i)
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term))
}

/**
 * Whole-word containment. A substring test would report "lock" as covered by
 * the site's own core topic and quietly hide every gap on that site.
 */
function mentionsTerm(haystack: string, term: string): boolean {
  const index = haystack.indexOf(term)
  if (index === -1) return false
  const boundary = /[a-z0-9à-ɏ]/i
  let cursor = index
  while (cursor !== -1) {
    const before = cursor === 0 ? "" : haystack.charAt(cursor - 1)
    const after = haystack.charAt(cursor + term.length)
    if (!boundary.test(before) && !boundary.test(after)) return true
    cursor = haystack.indexOf(term, cursor + 1)
  }
  return false
}

export interface ContentGapInput {
  queries: GapQueryRow[]
  /** Post body HTML. Stripped here rather than by the caller, so the panel and
   *  the dashboard cannot disagree about what counts as "on the page". */
  content: string
  /** Included in the searchable text — a query answered by the headline is not
   *  a gap. */
  title?: string
  metaDescription?: string
  /** Cap on returned suggestions per kind. A list of forty is a list nobody
   *  reads. */
  limitPerKind?: number
}

export function analyseContentGaps(input: ContentGapInput): ContentGap[] {
  const haystack = [
    stripHtml(input.content),
    input.title ?? "",
    input.metaDescription ?? "",
  ]
    .join(" ")
    .toLowerCase()

  const limit = input.limitPerKind ?? 8
  const gaps: ContentGap[] = []

  const striking: ContentGap[] = []
  const lowCtr: ContentGap[] = []
  const noMention: ContentGap[] = []

  for (const row of input.queries) {
    const query = row.query.trim()
    if (!query || row.impressions < MIN_IMPRESSIONS) continue

    const base = {
      query,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    }

    if (row.position >= STRIKING_MIN_POSITION && row.position <= STRIKING_MAX_POSITION) {
      striking.push({
        ...base,
        kind: "striking-distance",
        expectedCtr: null,
        headline: `Strengthen the section covering "${query}"`,
        evidence: `${row.impressions} impressions at position ${row.position.toFixed(1)}. Close enough that a better answer on the page can move it onto page one.`,
        priority: row.impressions,
      })
    }

    if (row.position <= 10 && row.impressions >= MIN_IMPRESSIONS_FOR_CTR) {
      const expected = expectedCtrForPosition(row.position)
      if (row.ctr < expected * CTR_SHORTFALL_RATIO) {
        lowCtr.push({
          ...base,
          kind: "low-ctr",
          expectedCtr: expected,
          headline: `Rewrite the title and meta description for "${query}"`,
          // Said explicitly, because the instinct on a low-CTR query is to add
          // more content — which cannot help. The page is already being shown
          // and already being passed over; that happens in the snippet.
          evidence: `Position ${row.position.toFixed(1)} with ${row.impressions} impressions but only ${percent(row.ctr)} click-through, against about ${percent(expected)} typical at that position. This is a title/description problem, not a content problem — the page is already being seen and skipped.`,
          priority: row.impressions * 1.2,
        })
      }
    }

    const terms = contentTerms(query)
    const missing = terms.filter((term) => !mentionsTerm(haystack, term))
    if (terms.length > 0 && missing.length > 0) {
      noMention.push({
        ...base,
        kind: "no-mention",
        expectedCtr: null,
        headline: `Consider a section covering "${query}"`,
        evidence: `${row.impressions} impressions at position ${row.position.toFixed(1)}, and ${missing.length === terms.length ? "none of its terms appear" : `"${missing.join('", "')}" ${missing.length === 1 ? "does not appear" : "do not appear"}`} anywhere on the page. Google is matching this loosely; a section that answers it directly would match it properly.`,
        priority: row.impressions * 1.5,
      })
    }
  }

  for (const bucket of [noMention, striking, lowCtr]) {
    gaps.push(...bucket.sort((a, b) => b.priority - a.priority).slice(0, limit))
  }

  return gaps
}
