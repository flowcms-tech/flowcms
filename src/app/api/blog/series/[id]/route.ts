import { NextRequest, NextResponse } from "next/server"
import { and, eq, ne } from "drizzle-orm"
import { db } from "@/db/client"
import { blogSeries } from "@/db/tables"
import { updateBlogSeriesSchema } from "@/Modules/Blog/Series/Values/Validations"
import { serializeSeries } from "../route"
import { CacheService, ADMIN_CACHE_TTL_SECONDS } from "@/Framework/Redis/CacheService"
import { changedFieldLabels, recordActivity, summariseChanges } from "@/db/activityLog"
import { TAXONOMY_FIELD_LABELS } from "@/Framework/Activity/fieldLabels"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { updateReturning } from "@/db/writes"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { id } = await params
  const row = await db.query.blogSeries.findFirst({ where: eq(blogSeries.id, id) })
  if (!row) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  const data = await CacheService.remember(`blog-series:detail:${id}`, ADMIN_CACHE_TTL_SECONDS, async () => {
    const [serialized] = await serializeSeries([row])
    return serialized
  })

  return NextResponse.json({ data, message: "OK" })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  const parsed = updateBlogSeriesSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const existing = await db.query.blogSeries.findFirst({ where: eq(blogSeries.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  if (parsed.data.slug && parsed.data.slug !== existing.slug) {
    const slugTaken = await db.query.blogSeries.findFirst({
      where: and(eq(blogSeries.slug, parsed.data.slug), ne(blogSeries.id, id)),
    })
    if (slugTaken) {
      return NextResponse.json({ message: ["This slug is already in use"] }, { status: 422 })
    }
  }

  // Empty string means "clear this field"; absent means "leave unchanged".
  const nullable = (value: string | undefined) => (value === undefined ? undefined : value || null)

  const updates: Partial<typeof blogSeries.$inferInsert> = { updatedAt: new Date() }
  if (parsed.data.name !== undefined) updates.name = parsed.data.name
  if (parsed.data.slug !== undefined) updates.slug = parsed.data.slug
  if (parsed.data.description !== undefined) updates.description = nullable(parsed.data.description)
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive

  const updated = await updateReturning(blogSeries, updates, eq(blogSeries.id, id))

  await CacheService.delPattern("blog-series:*")

  await recordActivity({
    actor: session.user,
    action: "updated",
    entityType: "series",
    entityId: updated.id,
    entityLabel: updated.name,
    summary: summariseChanges(changedFieldLabels(existing, updates, TAXONOMY_FIELD_LABELS)),
  })

  const [data] = await serializeSeries([updated])

  return NextResponse.json({ data, message: "Series updated" })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  const existing = await db.query.blogSeries.findFirst({ where: eq(blogSeries.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  // `blogPosts.seriesId` is `set null`, so this unlinks rather than cascades —
  // no post is ever destroyed by deleting the series it belonged to. The
  // confirm dialog says the same thing, because "delete series" reads like it
  // would take the posts with it.
  await db.delete(blogSeries).where(eq(blogSeries.id, id))
  await CacheService.delPattern("blog-series:*")
  // The posts themselves just lost a column value, so their cached shapes are
  // now wrong too.
  await CacheService.delPattern("blog-posts:*")

  await recordActivity({
    actor: session.user,
    action: "deleted",
    entityType: "series",
    entityId: id,
    entityLabel: existing.name,
    summary: "Deleted — its posts were unlinked, not deleted",
  })

  return NextResponse.json({ data: null, message: "Series deleted" })
}
