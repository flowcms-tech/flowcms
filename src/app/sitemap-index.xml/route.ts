import {
  countSitemapChunks,
  getNewsSitemapPosts,
} from "@/Modules/Blog/Public/Queries/sitemapQueries"
import { resolveSeoContext, joinUrl } from "@/Modules/Blog/Public/Values/buildPostMetadata"
import { getSettingsRow } from "@/Framework/Settings/SettingsService"

/**
 * The sitemap index.
 *
 * Hand-written because Next has no index convention: `MetadataRoute.Sitemap`
 * only ever emits a `<urlset>`, and exporting `generateSitemaps` from
 * `src/app/sitemap.ts` moves that file's output to `/sitemap/<id>.xml` while
 * leaving `/sitemap.xml` unserved.
 *
 * It lives at `/sitemap-index.xml` rather than `/sitemap.xml` because Next
 * refuses to build with both a metadata sitemap and a route handler resolving
 * to the same path ("Conflicting route and metadata at /sitemap.xml"). The old
 * URL is preserved by a permanent redirect in `next.config.ts` — it is already
 * submitted to Search Console and linked from elsewhere, and quietly 404ing it
 * would detach the whole blog from indexing.
 *
 * The chunk count comes from `countSitemapChunks`, the same function
 * `generateSitemaps` uses, so the index can never advertise a chunk that
 * 404s.
 */

export const dynamic = "force-dynamic"

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

export async function GET() {
  const { base } = await resolveSeoContext()
  const [chunkCount, settingsRow] = await Promise.all([countSitemapChunks(base), getSettingsRow()])

  const sitemapUrls = Array.from({ length: chunkCount }, (_, id) =>
    joinUrl(base, `/sitemap/${id}.xml`)
  )

  // Only listed when it is both enabled and non-empty: a News sitemap with no
  // eligible articles is a file Google fetches and reports as an error.
  if (settingsRow?.newsSitemapEnabled) {
    const newsPosts = await getNewsSitemapPosts()
    if (newsPosts.length > 0) sitemapUrls.push(joinUrl(base, "/blog/news-sitemap.xml"))
  }

  const lastModified = new Date().toISOString()
  const body = sitemapUrls
    .map(
      (url) => `  <sitemap>
    <loc>${escapeXml(url)}</loc>
    <lastmod>${lastModified}</lastmod>
  </sitemap>`
    )
    .join("\n")

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</sitemapindex>`

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  })
}
