import { getRecentPostsForFeed } from "@/Modules/Blog/Public/Queries/publicBlogQueries"
import {
  resolveSeoContext,
  joinUrl,
  feedChannelDescription,
} from "@/Modules/Blog/Public/Values/buildPostMetadata"

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
  const [posts, { base, siteName, tagline }] = await Promise.all([
    getRecentPostsForFeed(20),
    resolveSeoContext(),
  ])
  const feedUrl = joinUrl(base, "/blog/rss.xml")

  const items = posts
    .map((post) => {
      const url = joinUrl(base, `/blog/${post.slug}`)
      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <description>${escapeXml(post.excerpt)}</description>
      ${post.publishedAt ? `<pubDate>${post.publishedAt.toUTCString()}</pubDate>` : ""}
    </item>`
    })
    .join("\n")

  // <language> is a generic "en". It was "en-CA" — the region of the customer
  // whose site this codebase grew out of — declared on every install regardless
  // of where the operator actually is. FlowCMS ships English; it does not know
  // the country, and asserting the wrong one is worse than not saying.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(`${siteName} Blog`)}</title>
    <link>${escapeXml(joinUrl(base, "/blog"))}</link>
    <description>${escapeXml(feedChannelDescription(siteName, tagline))}</description>
    <language>en</language>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  })
}
