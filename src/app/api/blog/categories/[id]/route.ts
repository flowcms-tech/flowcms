import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { blogCategories } from "@/db/tables"
import { mediaPath } from "@/Framework/Storage/mediaUrl"
import { updateBlogCategorySchema } from "@/Modules/Blog/Categories/Values/Validations"
import { CacheService, ADMIN_CACHE_TTL_SECONDS } from "@/Framework/Redis/CacheService"
import { getBlogCategoryPostCounts } from "@/db/taxonomyPostCounts"
import { changedFieldLabels, recordActivity, summariseChanges } from "@/db/activityLog"
import { TAXONOMY_FIELD_LABELS } from "@/Framework/Activity/fieldLabels"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { updateReturning } from "@/db/writes"

type CategoryRow = typeof blogCategories.$inferSelect

async function serializeCategory(row: CategoryRow, depth = 0) {
  const [imageUrl, ogImageUrl, counts] = await Promise.all([
    row.imageKey ? Promise.resolve(mediaPath(row.imageKey)) : Promise.resolve(null),
    row.ogImageKey ? Promise.resolve(mediaPath(row.ogImageKey)) : Promise.resolve(null),
    getBlogCategoryPostCounts(row.id),
  ])

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    parentId: row.parentId,
    depth,
    imageKey: row.imageKey,
    imageUrl,
    ogImageKey: row.ogImageKey,
    ogImageUrl,
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

/** Walks up the ancestor chain from `proposedParentId`; true if it ever
 *  reaches `categoryId` (which would make categoryId its own ancestor). */
async function wouldCreateCycle(categoryId: string, proposedParentId: string): Promise<boolean> {
  if (proposedParentId === categoryId) return true

  const rows = await db.query.blogCategories.findMany()
  const parentById = new Map(rows.map((row) => [row.id, row.parentId]))

  const visited = new Set<string>()
  let current: string | null = proposedParentId
  while (current) {
    if (current === categoryId) return true
    if (visited.has(current)) break
    visited.add(current)
    current = parentById.get(current) ?? null
  }
  return false
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { id } = await params
  const category = await db.query.blogCategories.findFirst({ where: eq(blogCategories.id, id) })
  if (!category) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  const data = await CacheService.remember(`blog-categories:detail:${id}`, ADMIN_CACHE_TTL_SECONDS, () =>
    serializeCategory(category)
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
  const parsed = updateBlogCategorySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const existing = await db.query.blogCategories.findFirst({ where: eq(blogCategories.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  if (parsed.data.slug && parsed.data.slug !== existing.slug) {
    const slugTaken = await db.query.blogCategories.findFirst({ where: eq(blogCategories.slug, parsed.data.slug) })
    if (slugTaken) {
      return NextResponse.json({ message: ["This slug is already in use"] }, { status: 422 })
    }
  }

  if (parsed.data.parentId) {
    const parent = await db.query.blogCategories.findFirst({ where: eq(blogCategories.id, parsed.data.parentId) })
    if (!parent) {
      return NextResponse.json({ message: ["Selected parent category does not exist"] }, { status: 422 })
    }
    if (await wouldCreateCycle(id, parsed.data.parentId)) {
      return NextResponse.json(
        { message: ["A category cannot be moved under itself or one of its own subcategories"] },
        { status: 422 }
      )
    }
  }

  const updates: Partial<typeof blogCategories.$inferInsert> = { updatedAt: new Date() }
  if (parsed.data.name !== undefined) updates.name = parsed.data.name
  if (parsed.data.slug !== undefined) updates.slug = parsed.data.slug
  if (parsed.data.description !== undefined) updates.description = parsed.data.description || null
  if (parsed.data.parentId !== undefined) updates.parentId = parsed.data.parentId || null
  if (parsed.data.imageKey !== undefined) updates.imageKey = parsed.data.imageKey
  if (parsed.data.ogImageKey !== undefined) updates.ogImageKey = parsed.data.ogImageKey
  if (parsed.data.metaTitle !== undefined) updates.metaTitle = parsed.data.metaTitle || null
  if (parsed.data.metaDescription !== undefined) updates.metaDescription = parsed.data.metaDescription || null
  if (parsed.data.canonicalUrl !== undefined) updates.canonicalUrl = parsed.data.canonicalUrl || null
  if (parsed.data.isIndexable !== undefined) updates.isIndexable = parsed.data.isIndexable
  if (parsed.data.archiveIntro !== undefined) updates.archiveIntro = parsed.data.archiveIntro || null
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive

  const updated = await updateReturning(blogCategories, updates, eq(blogCategories.id, id))

  await CacheService.delPattern("blog-categories:*")

  await recordActivity({
    actor: session.user,
    action: "updated",
    entityType: "category",
    entityId: updated.id,
    entityLabel: updated.name,
    summary: summariseChanges(changedFieldLabels(existing, updates, TAXONOMY_FIELD_LABELS)),
  })

  return NextResponse.json({ data: await serializeCategory(updated), message: "Blog category updated" })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  const existing = await db.query.blogCategories.findFirst({ where: eq(blogCategories.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  const child = await db.query.blogCategories.findFirst({ where: eq(blogCategories.parentId, id) })
  if (child) {
    return NextResponse.json(
      { message: "Cannot delete a category that has subcategories — move or delete them first" },
      { status: 422 }
    )
  }

  await db.delete(blogCategories).where(eq(blogCategories.id, id))
  await CacheService.delPattern("blog-categories:*")

  // Deleting a category unlinks it from every post that was in it (the join
  // table cascades) and nulls it out as a primary category. The entry is the
  // only record that those posts ever belonged to it.
  await recordActivity({
    actor: session.user,
    action: "deleted",
    entityType: "category",
    entityId: id,
    entityLabel: existing.name,
    summary: `Deleted /blog/category/${existing.slug}`,
  })

  return NextResponse.json({ data: null, message: "Blog category deleted" })
}
