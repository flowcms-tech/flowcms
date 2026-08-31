import { NextRequest, NextResponse } from "next/server"
import { asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db/client"
import { authors, blogPosts } from "@/db/tables"
import { mediaPath } from "@/Framework/Storage/mediaUrl"
import { createAuthorSchema } from "@/Modules/Authors/Values/Validations"
import { CacheService, ADMIN_CACHE_TTL_SECONDS } from "@/Framework/Redis/CacheService"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { insertReturning } from "@/db/writes"

type AuthorRow = typeof authors.$inferSelect

/** Admin payloads use the authenticated media route — the public image route is only for
 *  crawler-facing pages. */
export async function serializeAuthors(rows: AuthorRow[]) {
  if (rows.length === 0) return []

  const authorIds = rows.map((row) => row.id)
  const posts = await db.query.blogPosts.findMany({
    where: inArray(blogPosts.authorProfileId, authorIds),
  })

  const postCountByAuthor = new Map<string, number>()
  for (const post of posts) {
    if (!post.authorProfileId) continue
    postCountByAuthor.set(post.authorProfileId, (postCountByAuthor.get(post.authorProfileId) ?? 0) + 1)
  }

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      jobTitle: row.jobTitle,
      credentials: row.credentials,
      bio: row.bio,
      avatarKey: row.avatarKey,
      avatarAltText: row.avatarAltText,
      avatarUrl: row.avatarKey
        ? mediaPath(row.avatarKey)
        : null,
      email: row.email,
      websiteUrl: row.websiteUrl,
      linkedinUrl: row.linkedinUrl,
      twitterUrl: row.twitterUrl,
      facebookUrl: row.facebookUrl,
      instagramUrl: row.instagramUrl,
      metaTitle: row.metaTitle,
      metaDescription: row.metaDescription,
      canonicalUrl: row.canonicalUrl,
      isIndexable: row.isIndexable,
      isActive: row.isActive,
      postCount: postCountByAuthor.get(row.id) ?? 0,
    }))
  )
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)
  const search = searchParams.get("search")?.trim().toLowerCase() || undefined

  const rows = await db.query.authors.findMany({ orderBy: asc(authors.name) })

  const filtered = search
    ? rows.filter(
        (row) =>
          row.name.toLowerCase().includes(search) ||
          (row.jobTitle ?? "").toLowerCase().includes(search)
      )
    : rows

  const data = await CacheService.remember(`authors:list:${search ?? "_"}`, ADMIN_CACHE_TTL_SECONDS, () =>
    serializeAuthors(filtered)
  )

  return NextResponse.json({ data, message: "OK" })
}

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const parsed = createAuthorSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const existingSlug = await db.query.authors.findFirst({
    where: eq(authors.slug, parsed.data.slug),
  })
  if (existingSlug) {
    return NextResponse.json({ message: ["This slug is already in use"] }, { status: 422 })
  }

  const created = await insertReturning(authors, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      jobTitle: parsed.data.jobTitle || null,
      credentials: parsed.data.credentials || null,
      bio: parsed.data.bio || null,
      avatarKey: parsed.data.avatarKey || null,
      avatarAltText: parsed.data.avatarAltText || null,
      email: parsed.data.email || null,
      websiteUrl: parsed.data.websiteUrl || null,
      linkedinUrl: parsed.data.linkedinUrl || null,
      twitterUrl: parsed.data.twitterUrl || null,
      facebookUrl: parsed.data.facebookUrl || null,
      instagramUrl: parsed.data.instagramUrl || null,
      metaTitle: parsed.data.metaTitle || null,
      metaDescription: parsed.data.metaDescription || null,
      canonicalUrl: parsed.data.canonicalUrl || null,
      isIndexable: parsed.data.isIndexable ?? true,
    })

  await CacheService.delPattern("authors:*")

  await recordActivity({
    actor: session.user,
    action: "created",
    entityType: "author",
    entityId: created.id,
    entityLabel: created.name,
    summary: `/blog/author/${created.slug}`,
  })

  const [data] = await serializeAuthors([created])

  return NextResponse.json({ data, message: "Author created" })
}
