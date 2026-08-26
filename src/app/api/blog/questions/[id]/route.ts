import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPostQuestions } from "@/db/tables"
import { canModerateQuestions, resolveRole } from "@/Framework/Auth/permissions"
import { updateQuestionSchema } from "@/Modules/Blog/Questions/Values/Validations"
import { CacheService } from "@/Framework/Redis/CacheService"
import { serializeQuestions } from "../route"
import { changedFieldLabels, recordActivity, summariseChanges } from "@/db/activityLog"
import { QUESTION_FIELD_LABELS } from "@/Framework/Activity/fieldLabels"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { updateReturning } from "@/db/writes"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate
  if (!canModerateQuestions(resolveRole(session.user.role))) {
    return NextResponse.json({ message: "Your role can't moderate reader questions" }, { status: 403 })
  }

  const { id } = await params
  const parsed = updateQuestionSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const existing = await db.query.blogPostQuestions.findFirst({
    where: eq(blogPostQuestions.id, id),
  })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  const nextAnswer =
    parsed.data.answer !== undefined ? parsed.data.answer.trim() || null : existing.answer
  const nextStatus = parsed.data.status ?? existing.status

  /**
   * The rule this whole feature rests on, checked against the MERGED row and
   * not just the request body.
   *
   * The schema's refinement only fires when a publish and an answer arrive
   * together. A PATCH that sends `{ status: "published" }` on its own — which is
   * exactly what a one-click Publish button sends — would otherwise slip past
   * it and put an unanswered question on the page and into the FAQPage graph.
   * A published-but-unanswered row is the one state that must be unreachable.
   */
  if (nextStatus === "published" && !nextAnswer) {
    return NextResponse.json(
      { message: ["Write an answer before publishing this question"] },
      { status: 422 }
    )
  }

  const updates: Partial<typeof blogPostQuestions.$inferInsert> = {}
  if (parsed.data.answer !== undefined) updates.answer = nextAnswer
  if (parsed.data.status !== undefined) updates.status = parsed.data.status
  if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority
  if (parsed.data.askerName !== undefined) updates.askerName = parsed.data.askerName.trim() || null

  // Stamped on the first answer and refreshed whenever the answer text changes,
  // because that is what the timestamp means — "when this reply was written",
  // not "when the row was last touched". A priority nudge is not a new answer.
  const answerChanged = parsed.data.answer !== undefined && nextAnswer !== existing.answer
  if (answerChanged && nextAnswer) {
    updates.answeredById = session.user.id
    updates.answeredAt = new Date()
  }

  const updated = await updateReturning(blogPostQuestions, updates, eq(blogPostQuestions.id, id))

  // Only the admin namespace. The public post page is `force-dynamic` and
  // reads its Q&A per request, so a published answer is live immediately —
  // there is no public cache here to invalidate, and inventing a namespace
  // nothing writes to would be a comment pretending to be code.
  await CacheService.delPattern("blog-questions:*")

  // Publishing a reader question puts text on a public page and into that
  // post's FAQPage graph, so it is a publication decision like any other and is
  // logged as approve/reject rather than as a generic field edit.
  const statusChanged = updates.status !== undefined && updated.status !== existing.status
  await recordActivity({
    actor: session.user,
    action:
      statusChanged && updated.status === "published"
        ? "approved"
        : statusChanged && updated.status === "rejected"
          ? "rejected"
          : "updated",
    entityType: "question",
    entityId: updated.id,
    entityLabel: updated.question,
    summary: summariseChanges(changedFieldLabels(existing, updates, QUESTION_FIELD_LABELS)),
    metadata: { postId: updated.postId },
  })

  const [data] = await serializeQuestions([updated])

  return NextResponse.json({ data, message: "Question updated" })
}

/**
 * Hard delete, not a status change.
 *
 * "rejected" exists for a real question this site chose not to answer — it is a
 * record worth keeping. Spam is not a record; it is noise that would make the
 * rejected list useless as an archive, so it goes away entirely.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate
  if (!canModerateQuestions(resolveRole(session.user.role))) {
    return NextResponse.json({ message: "Your role can't moderate reader questions" }, { status: 403 })
  }

  const { id } = await params
  const existing = await db.query.blogPostQuestions.findFirst({
    where: eq(blogPostQuestions.id, id),
  })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  await db.delete(blogPostQuestions).where(eq(blogPostQuestions.id, id))

  await CacheService.delPattern("blog-questions:*")

  await recordActivity({
    actor: session.user,
    action: "deleted",
    entityType: "question",
    entityId: id,
    entityLabel: existing.question,
    metadata: { postId: existing.postId },
  })

  return NextResponse.json({ data: null, message: "Question deleted" })
}
