import { NextRequest, NextResponse } from "next/server"
import { and, eq, ne } from "drizzle-orm"
import { db } from "@/db/client"
import { authors, blogPosts } from "@/db/tables"
import { updateAuthorSchema } from "@/Modules/Authors/Values/Validations"
import { serializeAuthors } from "../route"
import { CacheService, ADMIN_CACHE_TTL_SECONDS } from "@/Framework/Redis/CacheService"
import { changedFieldLabels, recordActivity, summariseChanges } from "@/db/activityLog"
import { AUTHOR_FIELD_LABELS } from "@/Framework/Activity/fieldLabels"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { updateReturning } from "@/db/writes"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { id } = await params
  const row = await db.query.authors.findFirst({ where: eq(authors.id, id) })
  if (!row) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  const data = await CacheService.remember(`authors:detail:${id}`, ADMIN_CACHE_TTL_SECONDS, async () => {
    const [serialized] = await serializeAuthors([row])
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
  const parsed = updateAuthorSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const existing = await db.query.authors.findFirst({ where: eq(authors.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  if (parsed.data.slug && parsed.data.slug !== existing.slug) {
    const slugTaken = await db.query.authors.findFirst({
      where: and(eq(authors.slug, parsed.data.slug), ne(authors.id, id)),
    })
    if (slugTaken) {
      return NextResponse.json({ message: ["This slug is already in use"] }, { status: 422 })
    }
  }

  // Empty string means "clear this field"; absent means "leave unchanged".
  const nullable = (value: string | undefined) => (value === undefined ? undefined : value || null)

  const updates: Partial<typeof authors.$inferInsert> = { updatedAt: new Date() }
  if (parsed.data.name !== undefined) updates.name = parsed.data.name
  if (parsed.data.slug !== undefined) updates.slug = parsed.data.slug
  if (parsed.data.jobTitle !== undefined) updates.jobTitle = nullable(parsed.data.jobTitle)
  if (parsed.data.credentials !== undefined) updates.credentials = nullable(parsed.data.credentials)
  if (parsed.data.bio !== undefined) updates.bio = nullable(parsed.data.bio)
  if (parsed.data.avatarKey !== undefined) updates.avatarKey = nullable(parsed.data.avatarKey)
  if (parsed.data.avatarAltText !== undefined) updates.avatarAltText = nullable(parsed.data.avatarAltText)
  if (parsed.data.email !== undefined) updates.email = nullable(parsed.data.email)
  if (parsed.data.websiteUrl !== undefined) updates.websiteUrl = nullable(parsed.data.websiteUrl)
  if (parsed.data.linkedinUrl !== undefined) updates.linkedinUrl = nullable(parsed.data.linkedinUrl)
  if (parsed.data.twitterUrl !== undefined) updates.twitterUrl = nullable(parsed.data.twitterUrl)
  if (parsed.data.facebookUrl !== undefined) updates.facebookUrl = nullable(parsed.data.facebookUrl)
  if (parsed.data.instagramUrl !== undefined) updates.instagramUrl = nullable(parsed.data.instagramUrl)
  if (parsed.data.metaTitle !== undefined) updates.metaTitle = nullable(parsed.data.metaTitle)
  if (parsed.data.metaDescription !== undefined) updates.metaDescription = nullable(parsed.data.metaDescription)
  if (parsed.data.canonicalUrl !== undefined) updates.canonicalUrl = nullable(parsed.data.canonicalUrl)
  if (parsed.data.isIndexable !== undefined) updates.isIndexable = parsed.data.isIndexable
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive

  const updated = await updateReturning(authors, updates, eq(authors.id, id))

  await CacheService.delPattern("authors:*")

  await recordActivity({
    actor: session.user,
    action: "updated",
    entityType: "author",
    entityId: updated.id,
    entityLabel: updated.name,
    summary: summariseChanges(changedFieldLabels(existing, updates, AUTHOR_FIELD_LABELS)),
  })

  const [data] = await serializeAuthors([updated])

  return NextResponse.json({ data, message: "Author updated" })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  const existing = await db.query.authors.findFirst({ where: eq(authors.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  // The FK is `set null`, so deleting would silently strip the byline off every
  // one of this author's posts. Refuse instead and say how many — an
  // unbylined published post is an E-E-A-T regression that is easy to miss.
  const assigned = await db.query.blogPosts.findMany({ where: eq(blogPosts.authorProfileId, id) })
  if (assigned.length > 0) {
    return NextResponse.json(
      {
        message: [
          `This author is credited on ${assigned.length} post${assigned.length === 1 ? "" : "s"}. ` +
            `Reassign or deactivate them instead — deactivating hides the author without touching the posts.`,
        ],
      },
      { status: 422 }
    )
  }

  await db.delete(authors).where(eq(authors.id, id))
  await CacheService.delPattern("authors:*")

  await recordActivity({
    actor: session.user,
    action: "deleted",
    entityType: "author",
    entityId: id,
    entityLabel: existing.name,
    summary: `Deleted /blog/author/${existing.slug} — no posts were credited to them`,
  })

  return NextResponse.json({ data: null, message: "Author deleted" })
}
