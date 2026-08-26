import Link from "next/link"
import { readingTimeMinutes, type PublicPostSummary } from "@/Themes/contract"

function formatDate(date: Date | null): string {
  if (!date) return ""
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" }).format(date)
}

export default function PostCard({ post }: { post: PublicPostSummary }) {
  // Null on posts written before wordCount existed — the card then just omits
  // the line rather than claiming "1 min read" for a 2000-word article.
  const minutes = post.wordCount ? readingTimeMinutes(post.wordCount) : null

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-border bg-background transition-colors hover:border-primary/50">
      <Link href={`/blog/${post.slug}`} className="block overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- served by our
            own public image route, not an optimizable remote pattern */}
        <img
          src={post.featuredImageUrl}
          alt={post.featuredImageAltText}
          width={1200}
          height={630}
          loading="lazy"
          className="aspect-[1200/630] w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-4">
        {post.categories.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {post.categories.map((category) => (
              <Link
                key={category.id}
                href={`/blog/category/${category.slug}`}
                className="text-xs font-medium text-primary hover:underline"
              >
                {category.name}
              </Link>
            ))}
          </div>
        )}

        <h2 className="text-base font-semibold leading-snug">
          <Link href={`/blog/${post.slug}`} className="hover:underline">
            {post.title}
          </Link>
        </h2>

        <p className="line-clamp-3 flex-1 text-sm text-muted-foreground">{post.excerpt}</p>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {post.author.name && <span>{post.author.name}</span>}
          {post.author.name && post.publishedAt && <span aria-hidden>·</span>}
          {post.publishedAt && (
            <time dateTime={post.publishedAt.toISOString()}>{formatDate(post.publishedAt)}</time>
          )}
          {minutes !== null && (post.publishedAt || post.author.name) && <span aria-hidden>·</span>}
          {minutes !== null && <span>{minutes} min read</span>}
        </div>
      </div>
    </article>
  )
}
