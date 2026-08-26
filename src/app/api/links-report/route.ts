import { NextRequest, NextResponse } from "next/server"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPosts } from "@/db/tables"
import { extractLinks } from "@/Modules/Blog/Posts/Values/contentStats"
import type { ExternalLinkRow, InternalLinkRow, InternalLinkSource, LinksReport } from "@/Modules/SearchConsole/Types"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * Internal/external link report, computed entirely from this site's own
 * published post content — Google exposes no API for link data (verified
 * absent from both the current `searchconsole` v1 API and the legacy
 * `webmasters` v3 one). Every row here comes from scanning the posts this
 * app already has in its own database, not from Search Console.
 */

function hostnameOf(href: string): string | null {
  try {
    return new URL(href).hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

/** Shared with the Action Feed route. */
export async function getLinksReport(): Promise<LinksReport> {
  const posts = await db.query.blogPosts.findMany({
    where: and(eq(blogPosts.isPublished, true), isNull(blogPosts.deletedAt)),
    columns: { id: true, slug: true, title: true, content: true },
  })

  if (posts.length === 0) {
    return {
      status: "no_pages",
      checkedAt: null,
      internalLinks: [],
      externalLinks: [],
      zeroInboundPosts: [],
      totalPosts: 0,
    }
  }

  const postsBySlug = new Map(posts.map((post) => [post.slug, post]))

  const internalBySlug = new Map<string, InternalLinkRow>()
  const externalByDomain = new Map<string, ExternalLinkRow>()

  for (const post of posts) {
    const source: InternalLinkSource = { id: post.id, slug: post.slug, title: post.title }
    const links = extractLinks(post.content)

    for (const link of links) {
      const internalSlug = link.href.match(/\/blog\/([^/?#]+)/)?.[1]
      // Only counted when the target is a post this app actually knows
      // about and can name — a link to a slug that doesn't (or no longer)
      // exist is a broken link, not an internal link, and belongs in a
      // 404/redirect report, not this one.
      if (internalSlug && postsBySlug.has(internalSlug)) {
        const target = postsBySlug.get(internalSlug)!
        const row = internalBySlug.get(internalSlug) ?? {
          targetId: target.id,
          targetSlug: internalSlug,
          targetTitle: target.title,
          inboundCount: 0,
          sources: [],
        }
        row.inboundCount += 1
        row.sources.push(source)
        internalBySlug.set(internalSlug, row)
        continue
      }

      if (/^https?:\/\//i.test(link.href)) {
        const domain = hostnameOf(link.href)
        if (!domain) continue
        const row = externalByDomain.get(domain) ?? { domain, count: 0, urls: [], sourcePosts: [] }
        row.count += 1
        if (!row.urls.includes(link.href)) row.urls.push(link.href)
        if (!row.sourcePosts.some((p) => p.slug === source.slug)) row.sourcePosts.push(source)
        externalByDomain.set(domain, row)
      }
    }
  }

  const internalLinks = Array.from(internalBySlug.values()).sort((a, b) => b.inboundCount - a.inboundCount)
  const externalLinks = Array.from(externalByDomain.values()).sort((a, b) => b.count - a.count)

  const zeroInboundPosts = posts
    .filter((post) => !internalBySlug.has(post.slug))
    .map((post) => ({ id: post.id, slug: post.slug, title: post.title }))

  return {
    status: "ok",
    checkedAt: new Date().toISOString(),
    internalLinks,
    externalLinks,
    zeroInboundPosts,
    totalPosts: posts.length,
  }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const data = await getLinksReport()
  if (data.status === "no_pages") {
    return NextResponse.json({ data, message: "No published pages" })
  }
  return NextResponse.json({ data, message: "Links report loaded" })
}
