import Link from "next/link"
import { cn, readingTimeMinutes, type PublicPostSummary } from "@/Themes/contract"

/**
 * Byline, date, reading time, and the honest "Last updated" line.
 *
 * Reading time is derived from the stored `wordCount` rather than counted here
 * — one stored number, one source of truth, and the 200 wpm divisor stays
 * tunable without a migration.
 */

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "long" }).format(date)
}

/**
 * "Last updated" renders only when the content update landed more than a day
 * after publication.
 *
 * A post corrected an hour after going live was never *updated* in the sense a
 * reader cares about, and a freshness line on a brand-new post is noise. The
 * source is `contentUpdatedAt`, which an editor sets deliberately — never
 * `updatedAt`, which bumps on a typo fix. Showing that as a content update is
 * the re-dating pattern Google treats as manipulative.
 */
const MEANINGFUL_UPDATE_MS = 24 * 60 * 60 * 1000

export function isMeaningfulUpdate(
  contentUpdatedAt: Date | null,
  publishedAt: Date | null
): boolean {
  if (!contentUpdatedAt) return false
  if (!publishedAt) return true
  return contentUpdatedAt.getTime() - publishedAt.getTime() > MEANINGFUL_UPDATE_MS
}

export default function PostMeta({
  author,
  publishedAt,
  wordCount,
  contentUpdatedAt = null,
  className,
}: {
  author: PublicPostSummary["author"]
  publishedAt: Date | null
  wordCount: number | null
  contentUpdatedAt?: Date | null
  className?: string
}) {
  const minutes = wordCount ? readingTimeMinutes(wordCount) : null
  const showUpdated = isMeaningfulUpdate(contentUpdatedAt, publishedAt)

  // Only a real author has an archive page. The admin-account fallback has no
  // slug, so linking it would be a link to nothing.
  const byline =
    author.isRealAuthor && author.slug ? (
      <Link href={`/blog/author/${author.slug}`} className="hover:underline">
        {author.name}
      </Link>
    ) : (
      author.name
    )

  return (
    <div className={cn("flex flex-col gap-1 text-sm text-muted-foreground", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {author.name && <span>{byline}</span>}
        {author.name && publishedAt && <span aria-hidden>·</span>}
        {publishedAt && <time dateTime={publishedAt.toISOString()}>{formatDate(publishedAt)}</time>}
        {minutes !== null && (publishedAt || author.name) && <span aria-hidden>·</span>}
        {minutes !== null && <span>{minutes} min read</span>}
      </div>

      {showUpdated && contentUpdatedAt && (
        <p className="text-xs">
          Last updated{" "}
          <time dateTime={contentUpdatedAt.toISOString()}>{formatDate(contentUpdatedAt)}</time>
        </p>
      )}
    </div>
  )
}
