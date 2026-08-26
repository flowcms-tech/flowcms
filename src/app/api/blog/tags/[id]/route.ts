import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { blogTags } from "@/db/tables"
import { updateBlogTagSchema } from "@/Modules/Blog/Tags/Values/Validations"
import { CacheService, ADMIN_CACHE_TTL_SECONDS } from "@/Framework/Redis/CacheService"
import { getBlogTagPostCounts } from "@/db/taxonomyPostCounts"
import { changedFieldLabels, recordActivity, summariseChanges } from "@/db/activityLog"
import { TAXONOMY_FIELD_LABELS } from "@/Framework/Activity/fieldLabels"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { updateReturning } from "@/db/writes"

type TagRow = typeof blogTags.$inferSelect

async function serializeTag(row: TagRow) {
  const counts = await getBlogTagPostCounts(row.id)

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { id } = await params
  const tag = await db.query.blogTags.findFirst({ where: eq(blogTags.id, id) })
  if (!tag) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  const data = await CacheService.remember(`blog-tags:detail:${id}`, ADMIN_CACHE_TTL_SECONDS, () =>
    serializeTag(tag)
  )

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
  const body = await request.json()
  const parsed = updateBlogTagSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const existing = await db.query.blogTags.findFirst({ where: eq(blogTags.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  if (parsed.data.slug && parsed.data.slug !== existing.slug) {
    const slugTaken = await db.query.blogTags.findFirst({ where: eq(blogTags.slug, parsed.data.slug) })
    if (slugTaken) {
      return NextResponse.json({ message: ["This slug is already in use"] }, { status: 422 })
    }
  }

  const updates: Partial<typeof blogTags.$inferInsert> = { updatedAt: new Date() }
  if (parsed.data.name !== undefined) updates.name = parsed.data.name
  if (parsed.data.slug !== undefined) updates.slug = parsed.data.slug
  if (parsed.data.metaTitle !== undefined) updates.metaTitle = parsed.data.metaTitle || null
  if (parsed.data.metaDescription !== undefined) updates.metaDescription = parsed.data.metaDescription || null
  if (parsed.data.canonicalUrl !== undefined) updates.canonicalUrl = parsed.data.canonicalUrl || null
  if (parsed.data.isIndexable !== undefined) updates.isIndexable = parsed.data.isIndexable
  if (parsed.data.archiveIntro !== undefined) updates.archiveIntro = parsed.data.archiveIntro || null
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive

  const updated = await updateReturning(blogTags, updates, eq(blogTags.id, id))

  await CacheService.delPattern("blog-tags:*")

  await recordActivity({
    actor: session.user,
    action: "updated",
    entityType: "tag",
    entityId: updated.id,
    entityLabel: updated.name,
    summary: summariseChanges(changedFieldLabels(existing, updates, TAXONOMY_FIELD_LABELS)),
  })

  return NextResponse.json({ data: await serializeTag(updated), message: "Blog tag updated" })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  const existing = await db.query.blogTags.findFirst({ where: eq(blogTags.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  await db.delete(blogTags).where(eq(blogTags.id, id))
  await CacheService.delPattern("blog-tags:*")

  await recordActivity({
    actor: session.user,
    action: "deleted",
    entityType: "tag",
    entityId: id,
    entityLabel: existing.name,
    summary: `Deleted /blog/tag/${existing.slug}`,
  })

  return NextResponse.json({ data: null, message: "Blog tag deleted" })
}
