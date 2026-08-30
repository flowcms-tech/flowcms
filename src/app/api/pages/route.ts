import { getAdminPath } from "@/Framework/Config/adminPath"
import { isReservedPath } from "@/Framework/Functions/reservedPaths"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { customPages } from "@/db/tables"
import { mediaPath } from "@/Framework/Storage/mediaUrl"
import { sanitizePostContent } from "@/Framework/Functions/sanitizePostContent"
import { createPageSchema } from "@/Modules/Pages/Values/Validations"
import { CacheService, ADMIN_CACHE_TTL_SECONDS } from "@/Framework/Redis/CacheService"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { insertReturning } from "@/db/writes"

type PageRow = typeof customPages.$inferSelect

async function serializePage(row: PageRow) {
  const ogImageUrl = row.ogImageKey
    ? mediaPath(row.ogImageKey)
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

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)
  const search = searchParams.get("search")?.trim().toLowerCase() || undefined

  const cacheKey = `pages:list:${search ?? "_"}`
  const data = await CacheService.remember(cacheKey, ADMIN_CACHE_TTL_SECONDS, async () => {
    const rows = await db.query.customPages.findMany()
    const filtered = search
      ? rows.filter((row) => row.title.toLowerCase().includes(search))
      : rows
    const ordered = [...filtered].sort((a, b) => a.title.localeCompare(b.title))
    return Promise.all(ordered.map(serializePage))
  })

  return NextResponse.json({ data, message: "OK" })
}

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const body = await request.json()
  const parsed = createPageSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  // The shared Zod schema already refuses the built-in reserved routes, but it
  // is a module-scope constant used in the browser too, so it cannot know this
  // installation's configured admin path. Checked here instead: a page saved
  // inside the admin namespace would be permanently unreachable, because the
  // proxy rewrites that namespace before routing ever reaches the catch-all.
  if (isReservedPath(parsed.data.path, getAdminPath())) {
    return NextResponse.json(
      { message: ["This path is reserved by the admin panel"] },
      { status: 422 }
    )
  }

  const existing = await db.query.customPages.findFirst({
    where: eq(customPages.path, parsed.data.path),
  })
  if (existing) {
    return NextResponse.json({ message: ["This path is already in use"] }, { status: 422 })
  }

  const created = await insertReturning(customPages, {
      title: parsed.data.title,
      path: parsed.data.path,
      content: sanitizePostContent(parsed.data.content),
      metaTitle: parsed.data.metaTitle || null,
      metaDescription: parsed.data.metaDescription || null,
      canonicalUrl: parsed.data.canonicalUrl || null,
      ogImageKey: parsed.data.ogImageKey || null,
      // The schema leaves isIndexable optional rather than defaulting it, so
      // .partial() on the update schema can't silently re-index a hidden
      // page. The true default belongs here, on create only.
      isIndexable: parsed.data.isIndexable ?? true,
      isPublished: false,
      createdById: session.user.id,
    })

  await CacheService.delPattern("pages:*")

  await recordActivity({
    actor: session.user,
    action: "created",
    entityType: "page",
    entityId: created.id,
    entityLabel: created.title,
    summary: created.path,
  })

  return NextResponse.json({ data: await serializePage(created), message: "Page created" })
}
