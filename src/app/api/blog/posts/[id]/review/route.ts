import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPosts } from "@/db/tables"
import { canApprove, canSubmitForReview, resolveRole } from "@/Framework/Auth/permissions"
import { reviewActionSchema } from "@/Modules/Blog/Posts/Values/reviewWorkflow"
import { CacheService } from "@/Framework/Redis/CacheService"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { updateReturning } from "@/db/writes"

/**
 * The review workflow's only write endpoint.
 *
 * Deliberately separate from `PATCH /api/blog/posts/[id]`. Review status is not
 * a field an editor types into a form alongside the meta description — it is a
 * state machine with its own actors, its own stamps (`reviewedById`,
 * `reviewedAt`), and its own audit meaning. Folding it into the post PATCH would
 * mean a contributor's ordinary save could carry `reviewStatus: "approved"`, and
 * the only thing standing between that and an approved post would be the
 * `omit` list on a Zod schema.
 *
 * It never touches `isPublished`. Approval means "an editor is happy with
 * this", not "this is live" — a post can be approved and still be a draft
 * someone is waiting to publish on a date, and conflating the two would take
 * that decision away from the person making it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params

  const parsed = reviewActionSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const existing = await db.query.blogPosts.findFirst({ where: eq(blogPosts.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }
  if (existing.deletedAt) {
    return NextResponse.json(
      { message: ["This post is in the trash. Restore it before reviewing it."] },
      { status: 422 }
    )
  }

  const role = resolveRole(session.user.role)
  const actorId = session.user.id
  const now = new Date()

  const updates: Partial<typeof blogPosts.$inferInsert> = { updatedAt: now }

  if (parsed.data.action === "submit") {
    if (!canSubmitForReview(role, actorId, existing)) {
      return NextResponse.json(
        { message: "You can only submit your own posts for review" },
        { status: 403 }
      )
    }
    if (existing.reviewStatus === "pending") {
      return NextResponse.json(
        { message: ["This post is already waiting for review"] },
        { status: 422 }
      )
    }

    updates.reviewStatus = "pending"
    // The previous reviewer's stamp is cleared on resubmission. Leaving it
    // would make the queue read as "already reviewed by X" for a post nobody
    // has looked at since it changed.
    updates.reviewedById = null
    updates.reviewedAt = null
    // The rejection note is kept until a *new* decision replaces it: the
    // contributor is resubmitting in response to it, and an editor comparing
    // the two wants to see what was asked for.
  } else {
    if (!canApprove(role)) {
      return NextResponse.json(
        { message: "Your role can't approve or reject submissions" },
        { status: 403 }
      )
    }
    if (existing.authorId === actorId) {
      // Not a hierarchy rule — an editor outranks their own post — but review
      // means a second pair of eyes, and a queue where people clear their own
      // submissions is a workflow that only looks like one.
      return NextResponse.json(
        { message: ["You can't review your own post. Ask another editor to look at it."] },
        { status: 422 }
      )
    }

    updates.reviewStatus = parsed.data.action === "approve" ? "approved" : "rejected"
    updates.reviewedById = actorId
    updates.reviewedAt = now
    // An approval clears any earlier rejection note, so the banner the
    // contributor sees matches the decision that actually stands.
    updates.reviewNote = parsed.data.action === "reject" ? parsed.data.note!.trim() : null
  }

  const updated = await updateReturning(blogPosts, updates, eq(blogPosts.id, id))

  // The posts list and the pending-review queue are both cached under this
  // namespace and both key off reviewStatus.
  await CacheService.delPattern("blog-posts:*")

  const messages: Record<string, string> = {
    submit: "Submitted for review",
    approve: "Post approved",
    reject: "Changes requested",
  }

  // The rejection note is copied into the entry rather than linked to: it lives
  // on the post and is cleared by the next decision, so the log would otherwise
  // record that changes were requested without ever being able to say which.
  await recordActivity({
    actor: session.user,
    action:
      parsed.data.action === "submit"
        ? "submitted"
        : parsed.data.action === "approve"
          ? "approved"
          : "rejected",
    entityType: "post",
    entityId: updated.id,
    entityLabel: existing.title,
    summary: parsed.data.action === "reject" ? `Requested changes: ${updated.reviewNote}` : null,
  })

  return NextResponse.json({
    data: {
      id: updated.id,
      reviewStatus: updated.reviewStatus,
      reviewedById: updated.reviewedById,
      reviewedAt: updated.reviewedAt,
      reviewNote: updated.reviewNote,
    },
    message: messages[parsed.data.action],
  })
}
