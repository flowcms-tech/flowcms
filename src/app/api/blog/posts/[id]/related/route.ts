import { NextRequest, NextResponse } from "next/server"
import { asc, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db/client"
import { blogPostRelated, blogPosts } from "@/db/tables"
import { getBlockingLock, lockConflictMessage } from "@/db/postLocks"
import { CacheService } from "@/Framework/Redis/CacheService"
import { canEditPost, resolveRole } from "@/Framework/Auth/permissions"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * Manual related-post overrides.
 *
 * Automatic scoring (shared categories, tags, series, cornerstone weight) is
 * what fills the related strip for every post at zero admin cost. These rows
 * exist only for the cases where the editor knows better, and when any are
 * present they win *entirely* — a half-honoured override is worse than none,
 * because the editor cannot tell whether their choice took effect.
 */

/** Three render, so six leaves room to reorder without a second save. Past
 *  that it stops being an override and becomes a second navigation. */
const MAX_RELATED = 6

/** Declared here rather than in `Values/Validations.ts` because nothing in the
 *  post form shares it — the related-posts panel is the only caller, and the
 *  rules that matter (self-reference, existence) are database questions the
 *  client could not answer anyway. */
const setRelatedSchema = z.object({
  relatedPostIds: z
    .array(z.string().min(1))
    .max(MAX_RELATED, `Pick at most ${MAX_RELATED} related posts`),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { id } = await params

  const post = await db.query.blogPosts.findFirst({ where: eq(blogPosts.id, id) })
  if (!post) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  const links = await db.query.blogPostRelated.findMany({
    where: eq(blogPostRelated.postId, id),
    orderBy: asc(blogPostRelated.position),
  })
  if (links.length === 0) {
    return NextResponse.json({ data: [], message: "OK" })
  }

  const related = await db.query.blogPosts.findMany({
    where: inArray(blogPosts.id, links.map((link) => link.relatedPostId)),
  })
  const byId = new Map(related.map((row) => [row.id, row]))

  // Position order, not database order, and a row whose target has since been
  // trashed is still returned with its state attached. Dropping it silently
  // would leave the editor looking at five chips where they saved six with no
  // explanation; the panel can grey it out and say why.
  const data = links.flatMap((link) => {
    const row = byId.get(link.relatedPostId)
    if (!row) return []
    return [{
      id: row.id,
      title: row.title,
      slug: row.slug,
      isPublished: row.isPublished,
      isTrashed: row.deletedAt !== null,
      position: link.position,
    }]
  })

  return NextResponse.json({ data, message: "OK" })
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  const parsed = setRelatedSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const post = await db.query.blogPosts.findFirst({ where: eq(blogPosts.id, id) })
  if (!post) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  // Related-post overrides change what renders under the post, so they are an
  // edit of it.
  if (!canEditPost(resolveRole(session.user.role), session.user.id, post)) {
    return NextResponse.json(
      { message: "You can only edit your own unpublished posts" },
      { status: 403 }
    )
  }

  const blockingLock = await getBlockingLock(id, session.user.id)
  if (blockingLock) {
    return NextResponse.json({ message: [lockConflictMessage(blockingLock)] }, { status: 409 })
  }

  // Order carries meaning here — it becomes `position` — so dedupe by hand
  // rather than through a Set round trip that would be tempting to reorder.
  const relatedPostIds: string[] = []
  for (const relatedId of parsed.data.relatedPostIds) {
    if (!relatedPostIds.includes(relatedId)) relatedPostIds.push(relatedId)
  }

  // `blog_post_related` has no CHECK constraint for this — SQLite cannot
  // express a cross-column one portably through Drizzle — so this route is the
  // only thing standing between a UI bug and a post listed as related to
  // itself, which renders as an infinite loop back to the page you are on.
  if (relatedPostIds.includes(id)) {
    return NextResponse.json({ message: ["A post can't be related to itself"] }, { status: 422 })
  }

  if (relatedPostIds.length > 0) {
    const found = await db.query.blogPosts.findMany({
      where: inArray(blogPosts.id, relatedPostIds),
    })
    if (found.length !== relatedPostIds.length) {
      return NextResponse.json(
        { message: ["One or more selected posts do not exist"] },
        { status: 422 }
      )
    }
  }

  // Replace-all rather than diff: the whole point of the override is that the
  // saved list *is* the list, and a partial write would leave a row from a
  // previous save sitting in the middle of the new order.
  await db.transaction(async (tx) => {
    await tx.delete(blogPostRelated).where(eq(blogPostRelated.postId, id))
    if (relatedPostIds.length > 0) {
      await tx.insert(blogPostRelated).values(
        relatedPostIds.map((relatedPostId, index) => ({
          postId: id,
          relatedPostId,
          position: index,
        }))
      )
    }
  })

  await CacheService.delPattern("blog-posts:*")

  return NextResponse.json({ data: relatedPostIds, message: "Related posts updated" })
}
