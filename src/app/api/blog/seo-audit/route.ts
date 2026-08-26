import { NextRequest, NextResponse } from "next/server"
import { desc, eq, isNull, sql } from "drizzle-orm"
import { db } from "@/db/client"
import { blogCategories, blogPostCategories, blogPostFaqs, blogPosts, blogPostTags, blogTags, linkCheckResults } from "@/db/tables"
import { CacheService } from "@/Framework/Redis/CacheService"
import { getBaseUrl } from "@/Framework/Settings/SettingsService"
import { publishDueScheduledPosts } from "@/db/blogPostScheduling"
import { buildSeoAudit, type AuditPostInput } from "@/Modules/Blog/SeoAudit/Values/auditIssues"
import type { SeoAuditReport } from "@/Modules/Blog/SeoAudit/Types"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * The SEO audit, computed on request.
 *
 * **Never stored.** A stored audit is stale the moment someone saves a post,
 * and an SEO tool that reports problems already fixed is one nobody opens
 * twice. The Redis cache below is short for the same reason: it exists to stop
 * a double-click re-parsing every post's HTML, not to keep an answer around.
 */
const CACHE_KEY = "blog-seo-audit:report"
const CACHE_TTL_SECONDS = 60

function parseStringArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    // One hand-edited row must not take down the screen that is the only place
    // to fix it from.
    return []
  }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  // Same reason every other blog read does this: there is no cron, so a post
  // whose scheduled time has passed only becomes published on the next read.
  // Auditing it as a draft when the public site already serves it would be
  // wrong in the one direction that matters.
  await publishDueScheduledPosts()

  const report = await CacheService.remember<SeoAuditReport>(CACHE_KEY, CACHE_TTL_SECONDS, async () => {
    const baseUrl = await getBaseUrl()

    const [postRows, categoryRows, tagRows, faqCounts, linkRows] = await Promise.all([
      db.select().from(blogPosts).where(isNull(blogPosts.deletedAt)),
      db
        .select({ postId: blogPostCategories.postId, name: blogCategories.name })
        .from(blogPostCategories)
        .innerJoin(blogCategories, eq(blogCategories.id, blogPostCategories.categoryId)),
      db
        .select({ postId: blogPostTags.postId, name: blogTags.name })
        .from(blogPostTags)
        .innerJoin(blogTags, eq(blogTags.id, blogPostTags.tagId)),
      db
        .select({ postId: blogPostFaqs.postId, count: sql<number>`count(*)` })
        .from(blogPostFaqs)
        .groupBy(blogPostFaqs.postId),
      db
        .select({
          postId: linkCheckResults.postId,
          url: linkCheckResults.url,
          result: linkCheckResults.result,
          statusCode: linkCheckResults.statusCode,
          checkedAt: linkCheckResults.checkedAt,
        })
        .from(linkCheckResults)
        .orderBy(desc(linkCheckResults.checkedAt)),
    ])

    const namesByPost = (rows: { postId: string; name: string }[]) => {
      const map = new Map<string, string[]>()
      for (const row of rows) {
        const bucket = map.get(row.postId)
        if (bucket) bucket.push(row.name)
        else map.set(row.postId, [row.name])
      }
      return map
    }

    const categoryNames = namesByPost(categoryRows)
    const tagNames = namesByPost(tagRows)
    const faqCountByPost = new Map(faqCounts.map((row) => [row.postId, Number(row.count)]))

    const posts: AuditPostInput[] = postRows.map((post) => ({
      id: post.id,
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      content: post.content,
      metaTitle: post.metaTitle,
      metaDescription: post.metaDescription,
      canonicalUrl: post.canonicalUrl,
      focusKeyword: post.focusKeyword,
      secondaryKeywords: parseStringArray(post.secondaryKeywords),
      featuredImageAltText: post.featuredImageAltText,
      categoryNames: categoryNames.get(post.id) ?? [],
      tagNames: tagNames.get(post.id) ?? [],
      faqCount: faqCountByPost.get(post.id) ?? 0,
      isIndexable: post.isIndexable,
      isPublished: post.isPublished,
      isCornerstone: post.isCornerstone,
      publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
      contentUpdatedAt: post.contentUpdatedAt ? post.contentUpdatedAt.toISOString() : null,
      updatedAt: post.updatedAt.toISOString(),
    }))

    return buildSeoAudit({
      posts,
      baseUrl,
      brokenLinks: linkRows
        .filter((row) => row.result === "broken")
        .map((row) => ({
          postId: row.postId,
          url: row.url,
          result: row.result,
          statusCode: row.statusCode,
        })),
      // Surfaced separately so the dashboard can state the caveat rather than
      // quietly folding refused requests into the broken count.
      unverifiableLinkCount: linkRows.filter((row) => row.result === "unverifiable" || row.result === "timeout")
        .length,
      lastLinkScanAt: linkRows.length > 0 ? linkRows[0].checkedAt.toISOString() : null,
    })
  })

  return NextResponse.json({ data: report, message: "SEO audit generated" })
}
