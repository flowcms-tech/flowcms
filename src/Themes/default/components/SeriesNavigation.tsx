import Link from "next/link"
import { cn, type PublicSeriesPost, type PublicSeriesRef } from "@/Themes/contract"

/**
 * Multi-part series navigation.
 *
 * Two pieces with one rule between them: **unpublished parts render as plain
 * text, never links.** Telling a reader that part 4 is coming is useful;
 * sending them to a 404 is not, and a draft must not become publicly reachable
 * through a nav strip.
 *
 * There is deliberately no `/blog/series/[slug]` archive yet, so the series
 * name is not a link — a fourth archive type brings its own metadata, sitemap
 * entries and noindex rules, and this strip carries most of the value.
 */

/** Position within the loaded list rather than the raw `seriesPosition`:
 *  positions are editor-entered and may have gaps, and "Part 7 of 4" is worse
 *  than no line at all. */
function partIndex(posts: PublicSeriesPost[], currentPostId: string): number {
  return posts.findIndex((post) => post.id === currentPostId)
}

/** The "Part 2 of 5" line that sits under the byline. */
export function SeriesPartLine({
  series,
  posts,
  currentPostId,
  className,
}: {
  series: PublicSeriesRef
  posts: PublicSeriesPost[]
  currentPostId: string
  className?: string
}) {
  const index = partIndex(posts, currentPostId)
  if (index < 0 || posts.length < 2) return null

  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      <span className="font-medium text-foreground">{series.name}</span>
      <span aria-hidden> · </span>
      Part {index + 1} of {posts.length}
    </p>
  )
}

export default function SeriesNavigation({
  series,
  posts,
  currentPostId,
}: {
  series: PublicSeriesRef
  posts: PublicSeriesPost[]
  currentPostId: string
}) {
  const index = partIndex(posts, currentPostId)
  if (index < 0 || posts.length < 2) return null

  // Prev/next skip unpublished parts: a "Next" button that leads nowhere is
  // worse than no button, even though the same part still appears in the list
  // below as a plain-text placeholder.
  const previous = [...posts.slice(0, index)].reverse().find((post) => post.isPublished)
  const next = posts.slice(index + 1).find((post) => post.isPublished)

  return (
    <section className="mt-12 rounded-xl border border-border p-4" aria-labelledby="series-heading">
      <h2 id="series-heading" className="text-sm font-semibold">
        {series.name}
      </h2>

      <ol className="mt-3 flex flex-col gap-2 text-sm">
        {posts.map((post, position) => {
          const isCurrent = post.id === currentPostId
          const label = `${position + 1}. ${post.title}`

          return (
            <li key={post.id} className="flex flex-wrap items-center gap-2">
              {isCurrent ? (
                <span aria-current="page" className="font-medium">
                  {label}
                </span>
              ) : post.isPublished ? (
                <Link
                  href={`/blog/${post.slug}`}
                  className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {label}
                </Link>
              ) : (
                <>
                  <span className="text-muted-foreground">{label}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                    Coming soon
                  </span>
                </>
              )}
            </li>
          )
        })}
      </ol>

      {(previous || next) && (
        <nav
          aria-label="Series navigation"
          className="mt-4 flex flex-wrap justify-between gap-3 border-t border-border pt-3 text-sm"
        >
          {previous ? (
            <Link href={`/blog/${previous.slug}`} rel="prev" className="hover:underline">
              ← {previous.title}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={`/blog/${next.slug}`} rel="next" className="text-right hover:underline">
              {next.title} →
            </Link>
          )}
        </nav>
      )}
    </section>
  )
}
