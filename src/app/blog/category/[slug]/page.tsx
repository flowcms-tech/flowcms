import type { Metadata } from "next"
import { notFound, permanentRedirect, redirect } from "next/navigation"
import { buildArchiveView } from "@/Modules/Blog/Public/ViewModels"
import { resolveSurface } from "@/Themes/resolver"
import ThemeShell from "@/Modules/Public/Components/ThemeShell"
import {
  getCategoryBySlug,
  getPublishedPosts,
} from "@/Modules/Blog/Public/Queries/publicBlogQueries"
import { buildTaxonomyMetadata } from "@/Modules/Blog/Public/Values/buildPostMetadata"
import { findRedirect } from "@/db/redirectMaintenance"

export const revalidate = 300

function parsePage(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "1", 10)
  return Number.isNaN(parsed) ? 1 : parsed
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string }>
}): Promise<Metadata> {
  const [{ slug }, { page }] = await Promise.all([params, searchParams])
  const category = await getCategoryBySlug(slug)
  if (!category) return {}

  // Paginated archives stay indexable and self-canonical, so the title has to
  // be unique per page — which means knowing the page count here.
  const { page: current, totalPages } = await getPublishedPosts({
    page: parsePage(page),
    categorySlug: slug,
  })
  return buildTaxonomyMetadata(category, "category", current, totalPages)
}

export default async function BlogCategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const [{ slug }, { page }] = await Promise.all([params, searchParams])

  const category = await getCategoryBySlug(slug)
  if (!category) {
    // Same not-found-only lookup as the post page: a manually-created
    // redirect (or a category deactivated after its archive URL was linked
    // elsewhere) resolves here instead of a bare 404.
    const match = await findRedirect(`/blog/category/${slug}`)
    if (match) {
      const isPermanent = match.statusCode === 301 || match.statusCode === 308
      if (isPermanent) permanentRedirect(match.toPath)
      redirect(match.toPath)
    }
    notFound()
  }

  const requestedPage = parsePage(page)
  const { posts, page: current, totalPages } = await getPublishedPosts({
    page: requestedPage,
    categorySlug: slug,
  })

  // A page number past the end returns 404 rather than an empty grid.
  if (requestedPage > totalPages) notFound()

  const view = await buildArchiveView(category, "category", posts, current, totalPages)

  // CategoryArchive, not the shared archive component. The two are separate
  // contract surfaces so a theme can make them differ; a route that asked for
  // the wrong one would look correct until somebody wrote such a theme.
  const { Component: CategoryArchive, settings } = await resolveSurface("CategoryArchive")

  return (
    <ThemeShell>
      <CategoryArchive {...view} settings={settings} />
    </ThemeShell>
  )
}
