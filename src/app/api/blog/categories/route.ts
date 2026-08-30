import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { blogCategories } from "@/db/tables"
import { mediaPath } from "@/Framework/Storage/mediaUrl"
import { createBlogCategorySchema } from "@/Modules/Blog/Categories/Values/Validations"
import { CacheService, ADMIN_CACHE_TTL_SECONDS } from "@/Framework/Redis/CacheService"
import { getBlogCategoryPostCounts, type TaxonomyPostCounts } from "@/db/taxonomyPostCounts"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { insertReturning } from "@/db/writes"

type CategoryRow = typeof blogCategories.$inferSelect

async function serializeCategory(row: CategoryRow, depth: number, counts: TaxonomyPostCounts) {
  // Plain string building now, where this used to be two presigning round
  // trips per category — so a category list no longer signs 2N URLs.
  const imageUrl = row.imageKey ? mediaPath(row.imageKey) : null
  const ogImageUrl = row.ogImageKey ? mediaPath(row.ogImageKey) : null

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

function flattenTree(rows: CategoryRow[]): { row: CategoryRow; depth: number }[] {
  const byParent = new Map<string | null, CategoryRow[]>()
  for (const row of rows) {
    const key = row.parentId ?? null
    const siblings = byParent.get(key) ?? []
    siblings.push(row)
    byParent.set(key, siblings)
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.name.localeCompare(b.name))
  }

  const result: { row: CategoryRow; depth: number }[] = []
  function visit(parentId: string | null, depth: number) {
    for (const row of byParent.get(parentId) ?? []) {
      result.push({ row, depth })
      visit(row.id, depth + 1)
    }
  }
  visit(null, 0)
  return result
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)
  const search = searchParams.get("search")?.trim().toLowerCase() || undefined

  const rows = await db.query.blogCategories.findMany()

  const ordered = search
    ? rows
        .filter((row) => row.name.toLowerCase().includes(search))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((row) => ({ row, depth: 0 }))
    : flattenTree(rows)

  // The cached payload now carries postCount, which changes when a *post* is
  // written — and post routes invalidate `blog-posts:*`, not this pattern. The
  // 60 s admin TTL is what bounds that staleness; a cross-module invalidation
  // for a number that is advisory would cost more than it buys.
  const cacheKey = `blog-categories:list:${search ?? "_"}`
  const data = await CacheService.remember(cacheKey, ADMIN_CACHE_TTL_SECONDS, async () => {
    const counts = await getBlogCategoryPostCounts()
    return Promise.all(ordered.map(({ row, depth }) => serializeCategory(row, depth, counts)))
  })

  return NextResponse.json({ data, message: "OK" })
}

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const body = await request.json()
  const parsed = createBlogCategorySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const existingSlug = await db.query.blogCategories.findFirst({
    where: eq(blogCategories.slug, parsed.data.slug),
  })
  if (existingSlug) {
    return NextResponse.json({ message: ["This slug is already in use"] }, { status: 422 })
  }

  if (parsed.data.parentId) {
    const parent = await db.query.blogCategories.findFirst({
      where: eq(blogCategories.id, parsed.data.parentId),
    })
    if (!parent) {
      return NextResponse.json({ message: ["Selected parent category does not exist"] }, { status: 422 })
    }
  }

  const created = await insertReturning(blogCategories, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description || null,
      parentId: parsed.data.parentId || null,
      imageKey: parsed.data.imageKey || null,
      ogImageKey: parsed.data.ogImageKey || null,
      metaTitle: parsed.data.metaTitle || null,
      metaDescription: parsed.data.metaDescription || null,
      canonicalUrl: parsed.data.canonicalUrl || null,
      // The schema leaves isIndexable optional rather than defaulting it, so
      // that `.partial()` on the update schema can't silently re-index a
      // hidden category. The `true` default belongs here, on create only.
      isIndexable: parsed.data.isIndexable ?? true,
      archiveIntro: parsed.data.archiveIntro || null,
      isActive: true,
    })

  await CacheService.delPattern("blog-categories:*")

  await recordActivity({
    actor: session.user,
    action: "created",
    entityType: "category",
    entityId: created.id,
    entityLabel: created.name,
    summary: `/blog/category/${created.slug}`,
  })

  // A brand-new category has no posts yet, so the counts are known to be zero
  // without a query.
  const data = await serializeCategory(created, 0, { total: new Map(), indexable: new Map() })

  return NextResponse.json({ data, message: "Blog category created" })
}
