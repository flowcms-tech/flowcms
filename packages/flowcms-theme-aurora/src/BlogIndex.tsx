import { JsonLd, type BlogIndexView, type ThemeSurfaceProps } from "flowcms/theme"

/**
 * The blog listing.
 *
 * `posts` are resolved, published, ordered summaries; pagination is already
 * decided. The theme renders them. Note that `BlogPost` is deliberately absent
 * from this package — a reader who clicks through gets the DEFAULT theme's post
 * surface, inside this theme's Layout, and it receives the DEFAULT theme's
 * settings rather than Aurora's.
 */
export default function BlogIndex({
  posts,
  page,
  totalPages,
  jsonLd,
}: ThemeSurfaceProps<BlogIndexView>) {
  return (
    <section data-surface="aurora-blog-index">
      <JsonLd data={jsonLd} />
      <h2>Aurora journal</h2>
      <ul>
        {posts.map((post) => (
          <li key={post.id}>
            <a href={`/blog/${post.slug}`}>{post.title}</a>
          </li>
        ))}
      </ul>
      <p>
        Page {page} of {totalPages}
      </p>
    </section>
  )
}
