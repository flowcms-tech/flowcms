import PostCard from "./components/PostCard"
import BlogPagination from "./components/BlogPagination"
import { JsonLd, type AuthorArchiveView } from "@/Themes/contract"

/** The link label. Falls back to the raw value rather than throwing — these
 *  come from admin-entered columns, and one malformed URL must not take the
 *  whole page down. */
function profileLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/**
 * The author archive. Modelled on BlogArchiveModule rather than folded into
 * it: that component's `kind` is `"category" | "tag"`, and an author page is
 * not a taxonomy — it leads with a person (avatar, role, credentials, profile
 * links), which is the whole reason the page is worth having.
 */
export default function AuthorArchive(view: AuthorArchiveView) {
  const { author, posts, page, totalPages, jsonLd } = view

  const basePath = `/blog/author/${author.slug}`

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12">
      <JsonLd data={jsonLd} />

      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start">
        {author.avatarUrl && (
          /* eslint-disable-next-line @next/next/no-img-element -- served by our
             own public image route, not an optimizable remote pattern */
          <img
            src={author.avatarUrl}
            alt={author.avatarAltText ?? author.name}
            width={96}
            height={96}
            className="size-24 shrink-0 rounded-full object-cover"
          />
        )}

        <div>
          <p className="text-sm text-muted-foreground">Author</p>
          <h1 className="text-2xl font-bold">{author.name}</h1>
          {author.jobTitle && (
            <p className="text-sm text-muted-foreground">{author.jobTitle}</p>
          )}
          {/* Credentials are the E-E-A-T payload — a licence number is the
              difference between a byline and a verifiable one, so it renders
              on the page rather than living only in the JSON-LD. */}
          {author.credentials && (
            <p className="mt-1 text-sm text-muted-foreground">{author.credentials}</p>
          )}
          {author.bio && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{author.bio}</p>}

          {author.sameAs.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-3">
              {author.sameAs.map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    // These point off-site to profiles we don't control.
                    rel="nofollow noopener me"
                    target="_blank"
                    className="text-sm text-primary underline-offset-4 hover:underline"
                  >
                    {profileLabel(url)}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No posts by this author yet.</p>
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
