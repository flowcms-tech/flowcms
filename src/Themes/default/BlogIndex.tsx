import PostCard from "./components/PostCard"
import BlogPagination from "./components/BlogPagination"
import { JsonLd, type BlogIndexView } from "@/Themes/contract"

export default function BlogIndex(view: BlogIndexView) {
  const { posts, page, totalPages, jsonLd } = view

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12">
      {/* Page-aware: the CollectionPage node carries this page's own URL, the
          same self-canonical rule the metadata builder applies. */}
      <JsonLd data={jsonLd} />

      {/* No standing subtitle. The line that used to sit here described one
          customer's subject matter ("locks, keys, and home security") and
          shipped on every install; a per-site blog description belongs in
          Settings, not baked into a theme. */}
      <header className="mb-8">
        <h1 className="text-2xl font-bold">Blog</h1>
      </header>

      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No posts published yet.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}

      <BlogPagination page={page} totalPages={totalPages} basePath="/blog" />
    </div>
  )
}
