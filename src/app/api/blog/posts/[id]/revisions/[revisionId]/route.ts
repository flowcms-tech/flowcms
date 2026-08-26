import { NextRequest, NextResponse } from "next/server"
import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPostRevisions, blogPosts } from "@/db/tables"
import { REVISION_RETENTION } from "@/db/schema/blogPostRevisions"
import { canEditPost, resolveRole } from "@/Framework/Auth/permissions"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { updateReturning } from "@/db/writes"

/**
 * Restore a post to a revision.
 *
 * A restore is itself an edit, so it snapshots the current state first —
 * otherwise restoring would be the one operation in the app that destroys
 * work with no way back.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; revisionId: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id, revisionId } = await params

  const post = await db.query.blogPosts.findFirst({ where: eq(blogPosts.id, id) })
  if (!post) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  // A restore overwrites the live body, so it is the largest edit this app
  // offers — it gets the same ownership rule as a plain save.
  if (!canEditPost(resolveRole(session.user.role), session.user.id, post)) {
    return NextResponse.json(
      { message: "You can only edit your own unpublished posts" },
      { status: 403 }
    )
  }

  const revision = await db.query.blogPostRevisions.findFirst({
    where: and(eq(blogPostRevisions.id, revisionId), eq(blogPostRevisions.postId, id)),
  })
  if (!revision) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  const updated = await db.transaction(async (tx) => {
    await tx.insert(blogPostRevisions).values({
      postId: id,
      title: post.title,
      excerpt: post.excerpt,
      content: post.content,
      editorId: session.user!.id!,
    })

    const kept = await tx.query.blogPostRevisions.findMany({
      where: eq(blogPostRevisions.postId, id),
      orderBy: desc(blogPostRevisions.createdAt),
    })
    const excess = kept.slice(REVISION_RETENTION)
    if (excess.length > 0) {
      await tx.delete(blogPostRevisions).where(
        inArray(blogPostRevisions.id, excess.map((r) => r.id))
      )
    }

    const row = await updateReturning(blogPosts, {
        title: revision.title,
        excerpt: revision.excerpt,
        // Already sanitized when it was first written, so no re-clean needed.
        content: revision.content,
        updatedAt: new Date(),
      }, eq(blogPosts.id, id))

    return row
  })

  // The revision's own timestamp, not this one: "reverted to the 14 July
  // version" is the fact someone needs, and the time of the revert is already
  // the entry's createdAt.
  await recordActivity({
    actor: session.user,
    action: "reverted",
    entityType: "post",
    entityId: updated.id,
    entityLabel: updated.title,
    summary: `Reverted title, excerpt, and content to the revision from ${revision.createdAt.toISOString()}`,
    metadata: { revisionId },
  })

  return NextResponse.json({
    data: { id: updated.id, title: updated.title, excerpt: updated.excerpt, content: updated.content },
    message: "Post restored to the selected revision",
  })
}
