import { NextRequest, NextResponse } from "next/server"
import { eq, asc, max } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPostFaqs, blogPosts } from "@/db/tables"
import { createFaqSchema } from "@/Modules/Blog/Posts/Values/FaqValidations"
import { canEditPost, resolveRole } from "@/Framework/Auth/permissions"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { insertReturning } from "@/db/writes"

function serializeFaq(row: typeof blogPostFaqs.$inferSelect) {
  return {
    id: row.id,
    postId: row.postId,
    question: row.question,
    answer: row.answer,
    priority: row.priority,
  }
}

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

  const rows = await db.query.blogPostFaqs.findMany({
    where: eq(blogPostFaqs.postId, id),
    orderBy: asc(blogPostFaqs.priority),
  })

  return NextResponse.json({ data: rows.map(serializeFaq), message: "OK" })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  const post = await db.query.blogPosts.findFirst({ where: eq(blogPosts.id, id) })
  if (!post) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  // An FAQ is part of the post and lands in its FAQPage markup, so writing one
  // is editing the post — same ownership rule, enforced in the same place.
  if (!canEditPost(resolveRole(session.user.role), session.user.id, post)) {
    return NextResponse.json(
      { message: "You can only edit your own unpublished posts" },
      { status: 403 }
    )
  }

  const body = await request.json()
  const parsed = createFaqSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const [{ value: maxPriority }] = await db
    .select({ value: max(blogPostFaqs.priority) })
    .from(blogPostFaqs)
    .where(eq(blogPostFaqs.postId, id))

  const created = await insertReturning(blogPostFaqs, {
      postId: id,
      question: parsed.data.question,
      answer: parsed.data.answer,
      priority: (maxPriority ?? -1) + 1,
    })

  // Filed against the post, not as an entity of its own. An FAQ has no screen
  // and no life outside its post — an entry that said "created FAQ #4" would be
  // unreadable a week later.
  await recordActivity({
    actor: session.user,
    action: "updated",
    entityType: "post",
    entityId: id,
    entityLabel: post.title,
    summary: `Added an FAQ: ${parsed.data.question}`,
  })

  return NextResponse.json({ data: serializeFaq(created), message: "FAQ created" })
}
