import { NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPostFaqs } from "@/db/tables"
import { updateFaqSchema } from "@/Modules/Blog/Posts/Values/FaqValidations"
import { checkPostEditAccess } from "@/db/postAccess"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { updateReturning } from "@/db/writes"

function serializeFaq(row: typeof blogPostFaqs.$inferSelect) {
  return {
    id: row.id,
    postId: row.postId,
    question: row.question,
    answer: row.answer,
    priority: row.priority,
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; faqId: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id, faqId } = await params

  // Editing an FAQ is editing the post it belongs to. This route never loads
  // the post row itself, so the ownership check gets its own read.
  const access = await checkPostEditAccess(id, session.user)
  if (!access.ok) {
    return NextResponse.json({ message: access.message }, { status: access.status })
  }

  const existing = await db.query.blogPostFaqs.findFirst({
    where: and(eq(blogPostFaqs.id, faqId), eq(blogPostFaqs.postId, id)),
  })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  const body = await request.json()
  const parsed = updateFaqSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const updates: Partial<typeof blogPostFaqs.$inferInsert> = { updatedAt: new Date() }
  if (parsed.data.question !== undefined) updates.question = parsed.data.question
  if (parsed.data.answer !== undefined) updates.answer = parsed.data.answer

  const updated = await updateReturning(blogPostFaqs, updates, eq(blogPostFaqs.id, faqId))

  await recordActivity({
    actor: session.user,
    action: "updated",
    entityType: "post",
    entityId: id,
    entityLabel: access.post.title,
    summary: `Edited the FAQ: ${updated.question}`,
  })

  return NextResponse.json({ data: serializeFaq(updated), message: "FAQ updated" })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; faqId: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id, faqId } = await params

  const access = await checkPostEditAccess(id, session.user)
  if (!access.ok) {
    return NextResponse.json({ message: access.message }, { status: access.status })
  }

  const existing = await db.query.blogPostFaqs.findFirst({
    where: and(eq(blogPostFaqs.id, faqId), eq(blogPostFaqs.postId, id)),
  })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  await db.delete(blogPostFaqs).where(eq(blogPostFaqs.id, faqId))

  await recordActivity({
    actor: session.user,
    action: "updated",
    entityType: "post",
    entityId: id,
    entityLabel: access.post.title,
    summary: `Deleted the FAQ: ${existing.question}`,
  })

  return NextResponse.json({ data: null, message: "FAQ deleted" })
}
