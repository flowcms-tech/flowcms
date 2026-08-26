import { getNewsSitemapPosts } from "@/Modules/Blog/Public/Queries/sitemapQueries"
import { resolveSeoContext, joinUrl } from "@/Modules/Blog/Public/Values/buildPostMetadata"
import { getSettingsRow } from "@/Framework/Settings/SettingsService"

/**
 * Google News sitemap.
 *
 * **This does nothing without an approved Google News publisher account.**
 * Without one, Google will not read the news namespace at all, and the file is
 * just a second sitemap listing a subset of what the main one already covers.
 * It is also, by protocol, limited to articles from the last 48 hours — for a
 * blog that publishes weekly it will usually be empty.
 *
 * It exists because it was asked for, and it is gated OFF by default
 * (`settings.newsSitemapEnabled`) so nobody enables it expecting results. Only
 * posts explicitly marked `schemaType = "NewsArticle"` appear: dumping
 * evergreen how-tos into a news feed is what gets a publisher account pulled.
 */

export const dynamic = "force-dynamic"

/** XML has no HTML entities beyond these five, so escape rather than rely on
 *  a CDATA block a title could itself close. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

export async function GET() {
  const row = await getSettingsRow()

  // 404 rather than an empty <urlset>: a disabled feature should be
  // indistinguishable from a route that was never built, so a crawler that
  // found the URL once stops asking.
  if (!row?.newsSitemapEnabled) {
    return new Response("Not found", { status: 404 })
  }

  const [posts, { base, siteName }] = await Promise.all([
    getNewsSitemapPosts(),
    resolveSeoContext(),
  ])

  const entries = posts
    .map((post) => {
      const url = joinUrl(base, `/blog/${post.slug}`)
      return `  <url>
    <loc>${escapeXml(url)}</loc>
    <news:news>
      <news:publication>
        <news:name>${escapeXml(siteName)}</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>${post.publishedAt.toISOString()}</news:publication_date>
      <news:title>${escapeXml(post.title)}</news:title>
    </news:news>
  </url>`
    })
    .join("\n")

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${entries}
</urlset>`

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Short: the 48-hour window means this file's contents expire on their
      // own schedule regardless of whether anything was published.
      "Cache-Control": "public, max-age=300",
    },
  })
}
