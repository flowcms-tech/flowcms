import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { blogTags } from "@/db/tables"
import { createBlogTagSchema } from "@/Modules/Blog/Tags/Values/Validations"
import { CacheService, ADMIN_CACHE_TTL_SECONDS } from "@/Framework/Redis/CacheService"
import { getBlogTagPostCounts, type TaxonomyPostCounts } from "@/db/taxonomyPostCounts"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { insertReturning } from "@/db/writes"

type TagRow = typeof blogTags.$inferSelect

/** The create path's counts are known to be zero without a query — a tag that
 *  did not exist a moment ago cannot be on a post. */
const NO_COUNTS: TaxonomyPostCounts = { total: new Map(), indexable: new Map() }

function serializeTag(row: TagRow, counts: TaxonomyPostCounts = NO_COUNTS) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    canonicalUrl: row.canonicalUrl,
    isIndexable: row.isIndexable,
    archiveIntro: row.archiveIntro,
    postCount: counts.total.get(row.id) ?? 0,
    indexablePostCount: counts.indexable.get(row.id) ?? 0,
    isActive: row.isActive,
  }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)
  const search = searchParams.get("search")?.trim().toLowerCase() || undefined

  // The cached payload now carries postCount, which changes when a *post* is
  // written — and post routes invalidate `blog-posts:*`, not this pattern. The
  // 60 s admin TTL is what bounds that staleness; a cross-module invalidation
  // for a number that is advisory would cost more than it buys.
  const data = await CacheService.remember(`blog-tags:list:${search ?? "_"}`, ADMIN_CACHE_TTL_SECONDS, async () => {
    const [rows, counts] = await Promise.all([db.query.blogTags.findMany(), getBlogTagPostCounts()])
    const filtered = search
      ? rows.filter((row) => row.name.toLowerCase().includes(search))
      : rows
    return filtered
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((row) => serializeTag(row, counts))
  })

  return NextResponse.json({ data, message: "OK" })
}

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const body = await request.json()
  const parsed = createBlogTagSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const existingSlug = await db.query.blogTags.findFirst({
    where: eq(blogTags.slug, parsed.data.slug),
  })
  if (existingSlug) {
    return NextResponse.json({ message: ["This slug is already in use"] }, { status: 422 })
  }

  const created = await insertReturning(blogTags, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      metaTitle: parsed.data.metaTitle || null,
      metaDescription: parsed.data.metaDescription || null,
      canonicalUrl: parsed.data.canonicalUrl || null,
      // The schema leaves isIndexable optional rather than defaulting it, so
      // that `.partial()` on the update schema can't silently re-index a
      // hidden tag. The `true` default belongs here, on create only.
      isIndexable: parsed.data.isIndexable ?? true,
      archiveIntro: parsed.data.archiveIntro || null,
      isActive: true,
    })

  await CacheService.delPattern("blog-tags:*")

  await recordActivity({
    actor: session.user,
    action: "created",
    entityType: "tag",
    entityId: created.id,
    entityLabel: created.name,
    summary: `/blog/tag/${created.slug}`,
  })

  return NextResponse.json({ data: serializeTag(created), message: "Blog tag created" })
}
