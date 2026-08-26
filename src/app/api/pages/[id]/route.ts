import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { customPages } from "@/db/tables"
import { StorageService } from "@/Framework/Storage/StorageService"
import { sanitizePostContent } from "@/Framework/Functions/sanitizePostContent"
import { updatePageSchema } from "@/Modules/Pages/Values/Validations"
import { upsertRedirectWithFlattening } from "@/db/redirectMaintenance"
import { CacheService } from "@/Framework/Redis/CacheService"
import { recordActivity, changedFieldLabels, summariseChanges } from "@/db/activityLog"
import { PAGE_FIELD_LABELS } from "@/Framework/Activity/fieldLabels"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { updateReturning } from "@/db/writes"

const IMAGE_URL_TTL_SECONDS = 3600

type PageRow = typeof customPages.$inferSelect

async function serializePage(row: PageRow) {
  const ogImageUrl = row.ogImageKey
    ? await StorageService.getPresignedDownloadUrl(row.ogImageKey, IMAGE_URL_TTL_SECONDS)
    : null

  return {
    id: row.id,
    title: row.title,
    path: row.path,
    content: row.content,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    canonicalUrl: row.canonicalUrl,
    ogImageKey: row.ogImageKey,
    ogImageUrl,
    isIndexable: row.isIndexable,
    isPublished: row.isPublished,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { id } = await params
  const existing = await db.query.customPages.findFirst({ where: eq(customPages.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ data: await serializePage(existing), message: "OK" })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  const existing = await db.query.customPages.findFirst({ where: eq(customPages.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  const parsed = updatePageSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  if (parsed.data.path && parsed.data.path !== existing.path) {
    const pathTaken = await db.query.customPages.findFirst({ where: eq(customPages.path, parsed.data.path) })
    if (pathTaken) {
      return NextResponse.json({ message: ["This path is already in use"] }, { status: 422 })
    }
  }

  const now = new Date()
  const updates: Partial<typeof customPages.$inferInsert> = { updatedAt: now }
  if (parsed.data.title !== undefined) updates.title = parsed.data.title
  if (parsed.data.path !== undefined) updates.path = parsed.data.path
  if (parsed.data.content !== undefined) updates.content = sanitizePostContent(parsed.data.content)
  if (parsed.data.metaTitle !== undefined) updates.metaTitle = parsed.data.metaTitle || null
  if (parsed.data.metaDescription !== undefined) updates.metaDescription = parsed.data.metaDescription || null
  if (parsed.data.canonicalUrl !== undefined) updates.canonicalUrl = parsed.data.canonicalUrl || null
  if (parsed.data.ogImageKey !== undefined) updates.ogImageKey = parsed.data.ogImageKey || null
  if (parsed.data.isIndexable !== undefined) updates.isIndexable = parsed.data.isIndexable

  // Sticky publishedAt, same as blogPosts: set once on first publish, never
  // cleared by unpublishing, so a later rename can still tell "was this path
  // ever live".
  const isPublishing = parsed.data.isPublished === true && !existing.isPublished
  const isUnpublishing = parsed.data.isPublished === false && existing.isPublished
  if (parsed.data.isPublished !== undefined) {
    updates.isPublished = parsed.data.isPublished
    if (isPublishing && !existing.publishedAt) updates.publishedAt = now
  }

  // A path change on a page that has ever been live orphans every inbound
  // link, so record a 301 before the old path stops resolving. Only for
  // pages with a publishedAt — a draft's path was never public, so
  // redirecting it would just be noise.
  const isPathChanging = parsed.data.path !== undefined && parsed.data.path !== existing.path
  const shouldRecordRedirect = isPathChanging && existing.publishedAt !== null

  const updated = await db.transaction(async (tx) => {
    const row = await updateReturning(customPages, updates, eq(customPages.id, id))
    if (shouldRecordRedirect) {
      await upsertRedirectWithFlattening(tx, existing.path, parsed.data.path as string, true)
    }
    return row
  })

  await CacheService.delPattern("pages:*")

  const action = isPublishing ? "published" : isUnpublishing ? "unpublished" : "updated"
  const fieldChanges = changedFieldLabels(existing, updates, PAGE_FIELD_LABELS)
  await recordActivity({
    actor: session.user,
    action,
    entityType: "page",
    entityId: id,
    entityLabel: updated.title,
    summary: action === "updated" ? summariseChanges(fieldChanges) : updated.path,
  })

  return NextResponse.json({ data: await serializePage(updated), message: "Page updated" })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  const existing = await db.query.customPages.findFirst({ where: eq(customPages.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  await db.delete(customPages).where(eq(customPages.id, id))
  await CacheService.delPattern("pages:*")

  await recordActivity({
    actor: session.user,
    action: "deleted",
    entityType: "page",
    entityId: id,
    entityLabel: existing.title,
    summary: `Permanently deleted ${existing.path}`,
  })

  return NextResponse.json({ data: null, message: "Page deleted" })
}
