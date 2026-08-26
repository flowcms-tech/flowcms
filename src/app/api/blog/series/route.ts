import { NextRequest, NextResponse } from "next/server"
import { asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPosts, blogSeries } from "@/db/tables"
import { createBlogSeriesSchema } from "@/Modules/Blog/Series/Values/Validations"
import { CacheService, ADMIN_CACHE_TTL_SECONDS } from "@/Framework/Redis/CacheService"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { insertReturning } from "@/db/writes"

type SeriesRow = typeof blogSeries.$inferSelect

/** `postCount` is derived, never stored — a stored counter goes stale the
 *  moment a post's series is changed from the post form. */
export async function serializeSeries(rows: SeriesRow[]) {
  if (rows.length === 0) return []

  const seriesIds = rows.map((row) => row.id)
  const posts = await db.query.blogPosts.findMany({
    where: inArray(blogPosts.seriesId, seriesIds),
  })

  const postCountBySeries = new Map<string, number>()
  for (const post of posts) {
    if (!post.seriesId) continue
    postCountBySeries.set(post.seriesId, (postCountBySeries.get(post.seriesId) ?? 0) + 1)
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    isActive: row.isActive,
    postCount: postCountBySeries.get(row.id) ?? 0,
  }))
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)
  const search = searchParams.get("search")?.trim().toLowerCase() || undefined

  const data = await CacheService.remember(`blog-series:list:${search ?? "_"}`, ADMIN_CACHE_TTL_SECONDS, async () => {
    const rows = await db.query.blogSeries.findMany({ orderBy: asc(blogSeries.name) })
    const filtered = search
      ? rows.filter((row) => row.name.toLowerCase().includes(search))
      : rows
    return serializeSeries(filtered)
  })

  return NextResponse.json({ data, message: "OK" })
}

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const parsed = createBlogSeriesSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const existingSlug = await db.query.blogSeries.findFirst({
    where: eq(blogSeries.slug, parsed.data.slug),
  })
  if (existingSlug) {
    return NextResponse.json({ message: ["This slug is already in use"] }, { status: 422 })
  }

  const created = await insertReturning(blogSeries, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description || null,
      isActive: true,
    })

  await CacheService.delPattern("blog-series:*")

  await recordActivity({
    actor: session.user,
    action: "created",
    entityType: "series",
    entityId: created.id,
    entityLabel: created.name,
  })

  const [data] = await serializeSeries([created])

  return NextResponse.json({ data, message: "Series created" })
}
