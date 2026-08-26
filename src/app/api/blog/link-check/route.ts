import { NextRequest, NextResponse } from "next/server"
import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPosts, linkCheckResults } from "@/db/tables"
import { scanPostLinks } from "@/Framework/Integrations/LinkChecker"
import { CacheService } from "@/Framework/Redis/CacheService"
import { linkScanSchema } from "@/Modules/Blog/SeoAudit/Values/Validations"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * Broken-link scanning. Manual trigger only — `POST` runs a scan, `GET` reads
 * back whatever the last scan found. There is no cron and no on-render hook by
 * design: this makes outbound HTTP requests to third-party hosts, and hanging
 * that off whichever visitor loads a page is a pattern this codebase has
 * already rejected once.
 */

/** Results are replaced wholesale per post, so a link an editor has since
 *  removed cannot linger in the report as a phantom problem. */
async function persist(
  postIds: string[],
  rows: (typeof linkCheckResults.$inferInsert)[]
): Promise<void> {
  await db.transaction(async (tx) => {
    if (postIds.length > 0) {
      await tx.delete(linkCheckResults).where(inArray(linkCheckResults.postId, postIds))
    }
    // SQLite has a hard limit on bound parameters per statement, so a
    // site-wide scan of a link-heavy blog has to go in batches rather than one
    // insert — the failure mode otherwise is a "too many variables" error only
    // the largest sites ever hit, which is the worst kind to discover in prod.
    for (let index = 0; index < rows.length; index += 200) {
      await tx.insert(linkCheckResults).values(rows.slice(index, index + 200))
    }
  })
}

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const body = await request.json().catch(() => ({}))
  const parsed = linkScanSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const posts = await db
    .select({ id: blogPosts.id, content: blogPosts.content })
    .from(blogPosts)
    .where(
      parsed.data.postId
        ? and(eq(blogPosts.id, parsed.data.postId), isNull(blogPosts.deletedAt))
        : isNull(blogPosts.deletedAt)
    )

  if (posts.length === 0) {
    return NextResponse.json(
      { message: [parsed.data.postId ? "That post does not exist or is in the trash." : "There are no posts to scan."] },
      { status: 422 }
    )
  }

  const scanned = await scanPostLinks(posts.map((post) => ({ postId: post.id, content: post.content })))

  const checkedAt = new Date()
  const rows = scanned.flatMap((result) =>
    result.links.map((link) => ({
      postId: result.postId,
      url: link.url,
      isInternal: link.isInternal,
      statusCode: link.statusCode,
      result: link.result,
      checkedAt,
    }))
  )

  await persist(
    posts.map((post) => post.id),
    rows
  )

  // The audit dashboard folds broken links into its issue list, so a fresh scan
  // has to drop its cached answer or the dashboard keeps showing the old one
  // for up to its TTL right after the operator pressed the button.
  await CacheService.delPattern("blog-seo-audit:*")

  const summary = rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.result] = (counts[row.result] ?? 0) + 1
    return counts
  }, {})

  return NextResponse.json({
    data: {
      postsScanned: posts.length,
      linksChecked: rows.length,
      summary,
      // Echoed back so the per-post scan on the edit screen can render its
      // result without a second round-trip.
      results: scanned,
      checkedAt: checkedAt.toISOString(),
    },
    message: `Scanned ${rows.length} link${rows.length === 1 ? "" : "s"} across ${posts.length} post${posts.length === 1 ? "" : "s"}`,
  })
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const postId = request.nextUrl.searchParams.get("postId")

  const rows = await db
    .select({
      id: linkCheckResults.id,
      postId: linkCheckResults.postId,
      postTitle: blogPosts.title,
      postSlug: blogPosts.slug,
      url: linkCheckResults.url,
      isInternal: linkCheckResults.isInternal,
      statusCode: linkCheckResults.statusCode,
      result: linkCheckResults.result,
      checkedAt: linkCheckResults.checkedAt,
    })
    .from(linkCheckResults)
    .innerJoin(blogPosts, eq(blogPosts.id, linkCheckResults.postId))
    .where(postId ? eq(linkCheckResults.postId, postId) : undefined)
    .orderBy(desc(linkCheckResults.checkedAt))

  const lastScannedAt = rows.length > 0 ? rows[0].checkedAt : null

  return NextResponse.json({
    data: {
      results: rows.map((row) => ({ ...row, checkedAt: row.checkedAt.toISOString() })),
      lastScannedAt: lastScannedAt ? lastScannedAt.toISOString() : null,
      summary: rows.reduce<Record<string, number>>((counts, row) => {
        counts[row.result] = (counts[row.result] ?? 0) + 1
        return counts
      }, {}),
    },
    message: "Link check results loaded",
  })
}
