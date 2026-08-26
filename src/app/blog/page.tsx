import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { buildBlogIndexView } from "@/Modules/Blog/Public/ViewModels"
import { resolveSurface } from "@/Themes/resolver"
import ThemeShell from "@/Modules/Public/Components/ThemeShell"
import { getPublishedPosts } from "@/Modules/Blog/Public/Queries/publicBlogQueries"
import { buildBlogIndexMetadata } from "@/Modules/Blog/Public/Values/buildPostMetadata"

// Not fully static: a statically generated index would never run
// publishDueScheduledPosts(), so a scheduled post could sit unpublished
// indefinitely. 300s bounds how stale the listing can get.
export const revalidate = 300

function parsePage(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "1", 10)
  return Number.isNaN(parsed) ? 1 : parsed
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}): Promise<Metadata> {
  const { page } = await searchParams
  // The title needs totalPages for "Page N of M", so it costs the same query
  // the body runs. Next dedupes it within the request.
  const { page: current, totalPages } = await getPublishedPosts({ page: parsePage(page) })
  return buildBlogIndexMetadata(current, totalPages)
}

export default async function BlogIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const { page } = await searchParams
  const requestedPage = parsePage(page)
  const { posts, page: current, totalPages } = await getPublishedPosts({ page: requestedPage })

  // A page number past the end returns 404 rather than an empty grid — an
  // infinite supply of thin, indexable pages is what ?page=999 otherwise is.
  if (requestedPage > totalPages) notFound()

  const view = await buildBlogIndexView(posts, current, totalPages)

  const { Component: BlogIndex, settings } = await resolveSurface("BlogIndex")

  return (
    <ThemeShell>
      <BlogIndex {...view} settings={settings} />
    </ThemeShell>
  )
}
