import PostCard from "./PostCard"
import type { PublicPostSummary } from "@/Themes/contract"

/**
 * Up to three related posts at the foot of an article.
 *
 * Reuses `PostCard` rather than a bespoke compact card: a reader should not
 * have to learn a second visual language for the same object, and the archive
 * grids already answer every layout question this block would otherwise
 * reopen.
 *
 * Renders nothing when the query found nothing. A "Related" heading over an
 * empty row, or padded out with unrelated posts, is how the block trains
 * readers to skip it.
 */
export default function RelatedPosts({ posts }: { posts: PublicPostSummary[] }) {
  if (posts.length === 0) return null

  return (
    <section className="mt-12 border-t border-border pt-8" aria-labelledby="related-heading">
      <h2 id="related-heading" className="mb-4 text-xl font-semibold">
        Related reading
      </h2>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
    </section>
  )
}
