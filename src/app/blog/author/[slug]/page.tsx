import type { Metadata } from "next"
import { notFound, permanentRedirect, redirect } from "next/navigation"
import { buildAuthorArchiveView } from "@/Modules/Blog/Public/ViewModels"
import { resolveSurface } from "@/Themes/resolver"
import ThemeShell from "@/Modules/Public/Components/ThemeShell"
import { findRedirect } from "@/db/redirectMaintenance"
import {
  getAuthorBySlug,
  getPublishedPostsByAuthor,
} from "@/Modules/Blog/Public/Queries/authorQueries"
import { buildAuthorMetadata } from "@/Modules/Blog/Public/Values/buildAuthorJsonLd"

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
  const author = await getAuthorBySlug(slug)
  if (!author) return {}

  // The metadata needs totalPages for the "Page N of M" title, so it costs the
  // same query the page body runs. Next dedupes it within the request.
  const { page: current, totalPages } = await getPublishedPostsByAuthor(author, parsePage(page))
  return buildAuthorMetadata(author, current, totalPages)
}

export default async function BlogAuthorPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const [{ slug }, { page }] = await Promise.all([params, searchParams])

  const author = await getAuthorBySlug(slug)
  if (!author) {
    // Same not-found-only lookup as the post and taxonomy pages: an author
    // deactivated (or renamed) after their archive URL was linked elsewhere
    // resolves through the redirect table instead of a bare 404.
    const match = await findRedirect(`/blog/author/${slug}`)
    if (match) {
      const isPermanent = match.statusCode === 301 || match.statusCode === 308
      if (isPermanent) permanentRedirect(match.toPath)
      redirect(match.toPath)
    }
    notFound()
  }

  const requestedPage = parsePage(page)
  const { posts, page: current, totalPages } = await getPublishedPostsByAuthor(author, requestedPage)

  // A page number past the end returns 404 rather than an empty grid — an
  // infinite supply of thin, indexable pages is what ?page=999 otherwise is.
  if (requestedPage > totalPages) notFound()

  const view = await buildAuthorArchiveView(author, posts, current, totalPages)

  const { Component: AuthorArchive, settings } = await resolveSurface("AuthorArchive")

  return (
    <ThemeShell>
      <AuthorArchive {...view} settings={settings} />
    </ThemeShell>
  )
}
