import Link from "next/link"

/**
 * Archive pager.
 *
 * `rel="prev"` / `rel="next"` are kept even though **Google has ignored them
 * as an indexing signal since 2019**. They cost nothing, some browsers still
 * use them for prefetch and reader modes, and removing them would look like a
 * fix while changing nothing about how the archive is crawled. The thing that
 * actually matters for pagination lives in `buildTaxonomyMetadata`: every page
 * is indexable and canonical to itself.
 */
export default function BlogPagination({
  page,
  totalPages,
  basePath,
}: {
  page: number
  totalPages: number
  basePath: string
}) {
  if (totalPages <= 1) return null

  const href = (target: number) => (target === 1 ? basePath : `${basePath}?page=${target}`)

  return (
    <nav className="flex items-center justify-center gap-2 pt-4" aria-label="Blog pages">
      {page > 1 && (
        <Link
          href={href(page - 1)}
          rel="prev"
          className="rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-muted"
        >
          Previous
        </Link>
      )}

      <span className="px-3 py-2 text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </span>

      {page < totalPages && (
        <Link
          href={href(page + 1)}
          rel="next"
          className="rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-muted"
        >
          Next
        </Link>
      )}
    </nav>
  )
}
