import type { Metadata } from "next"
import { notFound, permanentRedirect, redirect } from "next/navigation"
import { resolveSurface } from "@/Themes/resolver"
import ThemeShell from "@/Modules/Public/Components/ThemeShell"
import { buildPageView } from "@/Modules/Pages/Public/ViewModels"
import { getPublishedPageByPath } from "@/Modules/Pages/Public/Queries/publicPageQueries"
import { buildPageMetadata } from "@/Modules/Pages/Public/Values/buildPageMetadata"
import { findRedirect } from "@/db/redirectMaintenance"
import { recordNotFound } from "@/db/notFoundLogging"

// A page's isPublished can flip at any time — no build-time snapshot.
export const dynamic = "force-dynamic"

type PageProps = {
  params: Promise<{ path: string[] }>
}

function toPath(segments: string[]): string {
  return `/${segments.join("/")}`
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { path } = await params
  const page = await getPublishedPageByPath(toPath(path))
  if (!page) return {}
  return buildPageMetadata(page)
}

export default async function CustomPage({ params }: PageProps) {
  const { path } = await params
  const fullPath = toPath(path)
  const page = await getPublishedPageByPath(fullPath)

  if (!page) {
    // Redirects resolve here rather than in src/proxy.ts, which must never
    // transitively import the DB client. The extra query only runs on the
    // 404 path, so the common case is unaffected. Next always resolves a
    // more specific static/dynamic route (/blog, the admin namespace, /api,
    // /preview, robots.ts, sitemap.ts) ahead of this root catch-all, so
    // this branch only ever runs for paths nothing else claimed.
    const match = await findRedirect(fullPath)
    if (match) {
      const isPermanent = match.statusCode === 301 || match.statusCode === 308
      if (isPermanent) permanentRedirect(match.toPath)
      redirect(match.toPath)
    }
    await recordNotFound(fullPath)
    notFound()
  }

  const { Component: Page, settings } = await resolveSurface("Page")

  return (
    <ThemeShell>
      <Page {...buildPageView(page)} settings={settings} />
    </ThemeShell>
  )
}
