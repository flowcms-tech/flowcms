import { NextRequest, NextResponse } from "next/server"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPosts } from "@/db/tables"
import { extractHeadingsFlat, extractLinks, slugifyText } from "@/Modules/Blog/Posts/Values/contentStats"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * Internal link suggestions for the editor panel.
 *
 * The hardest part of internal linking is remembering what you have already
 * written. This ranks the published archive against what the editor is writing
 * now and hands back the ten best candidates — it never inserts anything; the
 * panel does that on an explicit click.
 *
 * A STATIC segment sibling of `[id]`, deliberately. Next resolves static
 * segments before dynamic ones, so `/api/blog/posts/link-suggestions` reaches
 * this file rather than being swallowed by `posts/[id]` with `id` bound to the
 * literal string "link-suggestions".
 */

const MAX_SUGGESTIONS = 10

/** Words that match everything and therefore rank nothing. Kept short on
 *  purpose: an aggressive stop list on a two-word query like "key cutting"
 *  leaves nothing to score with. */
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "your", "you", "are", "was", "how", "why", "what",
  "when", "who", "that", "this", "from", "can", "does", "into", "out", "not",
  "but", "all", "any", "get", "got", "has", "have", "our", "its", "their",
])

/** A focus keyword is a stated ranking target, so a candidate matching one is
 *  a stronger signal than a candidate that merely uses the word in its title. */
const WEIGHT_FOCUS_KEYWORD = 4
const WEIGHT_TITLE = 3
const WEIGHT_HEADING = 2
/** Pillar content should be the default destination for an internal link —
 *  that is most of what makes it pillar content. */
const BOOST_CORNERSTONE = 2
/** The whole query appearing verbatim in a title beats the same words scattered
 *  across it. */
const BONUS_EXACT_PHRASE = 5

function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
    )
  )
}

function countMatches(haystack: string, tokens: string[]): number {
  const text = haystack.toLowerCase()
  return tokens.filter((token) => text.includes(token)).length
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)
  const postId = searchParams.get("postId")?.trim() || null
  const query = searchParams.get("q")?.trim() || ""

  const source = postId
    ? await db.query.blogPosts.findFirst({ where: eq(blogPosts.id, postId) })
    : null

  // An explicit query wins; otherwise the source post's own focus keyword and
  // title are the best available statement of what it is about.
  const subject = query || [source?.focusKeyword ?? "", source?.title ?? ""].join(" ").trim()
  const tokens = tokenize(subject)
  if (tokens.length === 0) {
    return NextResponse.json({ data: [], message: "OK" })
  }
  const phrase = subject.toLowerCase().trim()

  // Slugs the source already links to. Suggesting a link that is three
  // paragraphs up is how an editor learns to stop reading the panel — and it is
  // the same extractor the analyser counts internal links with, so the two can
  // never disagree about what "already linked" means.
  const alreadyLinked = new Set<string>()
  if (source) {
    for (const link of extractLinks(source.content)) {
      const match = link.href.match(/\/blog\/([a-z0-9-]+)/i)
      if (match) alreadyLinked.add(match[1].toLowerCase())
    }
  }

  // Only published, untrashed posts — suggesting a link to a draft produces a
  // 404 the moment it is inserted.
  const candidates = await db.query.blogPosts.findMany({
    where: and(eq(blogPosts.isPublished, true), isNull(blogPosts.deletedAt)),
  })

  const scored = candidates.flatMap((candidate) => {
    if (source && candidate.id === source.id) return []
    if (alreadyLinked.has(candidate.slug.toLowerCase())) return []

    const headingText = extractHeadingsFlat(candidate.content)
      .map((heading) => heading.text)
      .join(" ")

    let score =
      countMatches(candidate.title, tokens) * WEIGHT_TITLE +
      countMatches(candidate.focusKeyword ?? "", tokens) * WEIGHT_FOCUS_KEYWORD +
      countMatches(headingText, tokens) * WEIGHT_HEADING

    if (score === 0) return []

    // The slug is a second look at the title, so it is a tiebreaker rather than
    // a scored signal of its own.
    if (phrase.length >= 3 && candidate.title.toLowerCase().includes(phrase)) score += BONUS_EXACT_PHRASE
    if (slugifyText(phrase) && candidate.slug.includes(slugifyText(phrase))) score += 1
    if (candidate.isCornerstone) score += BOOST_CORNERSTONE

    return [{
      id: candidate.id,
      title: candidate.title,
      slug: candidate.slug,
      focusKeyword: candidate.focusKeyword,
      isCornerstone: candidate.isCornerstone,
      score,
    }]
  })

  // Ties break towards cornerstone, then alphabetically — a stable order, so
  // the panel does not reshuffle between keystrokes that changed nothing.
  scored.sort((a, b) =>
    b.score - a.score ||
    Number(b.isCornerstone) - Number(a.isCornerstone) ||
    a.title.localeCompare(b.title)
  )

  return NextResponse.json({ data: scored.slice(0, MAX_SUGGESTIONS), message: "OK" })
}
