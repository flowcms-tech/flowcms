import type { Metadata } from "next"
import { notFound, permanentRedirect, redirect } from "next/navigation"
import { buildArchiveView } from "@/Modules/Blog/Public/ViewModels"
import { resolveSurface } from "@/Themes/resolver"
import ThemeShell from "@/Modules/Public/Components/ThemeShell"
import {
  getTagBySlug,
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
  const tag = await getTagBySlug(slug)
  if (!tag) return {}

  const { page: current, totalPages } = await getPublishedPosts({
    page: parsePage(page),
    tagSlug: slug,
  })
  return buildTaxonomyMetadata(tag, "tag", current, totalPages)
}

export default async function BlogTagPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const [{ slug }, { page }] = await Promise.all([params, searchParams])

  const tag = await getTagBySlug(slug)
  if (!tag) {
    const match = await findRedirect(`/blog/tag/${slug}`)
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
    tagSlug: slug,
  })

  // A page number past the end returns 404 rather than an empty grid.
  if (requestedPage > totalPages) notFound()

  const view = await buildArchiveView(tag, "tag", posts, current, totalPages)

  const { Component: TagArchive, settings } = await resolveSurface("TagArchive")

  return (
    <ThemeShell>
      <TagArchive {...view} settings={settings} />
    </ThemeShell>
  )
}
