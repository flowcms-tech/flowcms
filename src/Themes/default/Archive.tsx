import PostCard from "./components/PostCard"
import BlogPagination from "./components/BlogPagination"
import { JsonLd, type ArchiveView } from "@/Themes/contract"

export default function Archive(view: ArchiveView) {
  const { taxonomy, kind, posts, page, totalPages, jsonLd } = view

  const basePath = `/blog/${kind}/${taxonomy.slug}`

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12">
      <JsonLd data={jsonLd} />

      <header className="mb-8">
        <p className="text-sm text-muted-foreground">
          {kind === "category" ? "Category" : "Tag"}
        </p>
        <h1 className="text-2xl font-bold">{taxonomy.name}</h1>
        {taxonomy.description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{taxonomy.description}</p>
        )}

        {/* Page 1 only. The intro is what makes the archive a page rather than
            a list; repeating it on every paginated page would make each of
            those pages mostly-duplicate copy of page 1, which is the exact
            problem the per-page titles exist to avoid. */}
        {page === 1 && taxonomy.archiveIntro && (
          <div className="mt-4 max-w-2xl whitespace-pre-line text-sm text-muted-foreground">
            {taxonomy.archiveIntro}
          </div>
        )}
      </header>

      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No posts in this {kind} yet.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}

      <BlogPagination page={page} totalPages={totalPages} basePath={basePath} />
    </div>
  )
}
