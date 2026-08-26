import { NextRequest, NextResponse } from "next/server"
import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPostQuestions, blogPosts, users } from "@/db/tables"
import { canModerateQuestions, resolveRole } from "@/Framework/Auth/permissions"
import { QUESTION_STATUSES, type QuestionStatus } from "@/Modules/Blog/Questions/Values/Validations"
import { CacheService, ADMIN_CACHE_TTL_SECONDS } from "@/Framework/Redis/CacheService"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

type QuestionRow = typeof blogPostQuestions.$inferSelect

/** Shared with the [id] route so a PATCH's response and a list row can never
 *  describe the same question differently. */
export async function serializeQuestions(rows: QuestionRow[]) {
  if (rows.length === 0) return []

  const postIds = Array.from(new Set(rows.map((row) => row.postId)))
  const answererIds = Array.from(
    new Set(rows.map((row) => row.answeredById).filter((id): id is string => !!id))
  )

  const [postRows, answerers] = await Promise.all([
    db.query.blogPosts.findMany({ where: inArray(blogPosts.id, postIds) }),
    answererIds.length > 0
      ? db.query.users.findMany({ where: inArray(users.id, answererIds) })
      : Promise.resolve([]),
  ])

  const postById = new Map(postRows.map((post) => [post.id, post]))
  const userById = new Map(answerers.map((user) => [user.id, user]))

  return rows.map((row) => {
    const post = postById.get(row.postId)
    const answerer = row.answeredById ? userById.get(row.answeredById) : undefined

    return {
      id: row.id,
      postId: row.postId,
      post: post ? { id: post.id, title: post.title, slug: post.slug } : null,
      askerName: row.askerName,
      question: row.question,
      answer: row.answer,
      status: row.status,
      priority: row.priority,
      answeredBy: answerer ? { id: answerer.id, name: answerer.name ?? "" } : null,
      answeredAt: row.answeredAt,
      createdAt: row.createdAt,
    }
  })
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate
  if (!canModerateQuestions(resolveRole(session.user.role))) {
    return NextResponse.json({ message: "Your role can't moderate reader questions" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const statusParam = searchParams.get("status")?.trim() || undefined
  const status = QUESTION_STATUSES.includes(statusParam as QuestionStatus)
    ? (statusParam as QuestionStatus)
    : undefined
  const postId = searchParams.get("postId")?.trim() || undefined

  const conditions = [
    status ? eq(blogPostQuestions.status, status) : undefined,
    postId ? eq(blogPostQuestions.postId, postId) : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => !!condition)

  const data = await CacheService.remember(
    `blog-questions:list:${status ?? "_"}:${postId ?? "_"}`,
    ADMIN_CACHE_TTL_SECONDS,
    async () => {
      const rows = await db.query.blogPostQuestions.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        // Priority first because it is the published order, then oldest-first
        // within it: a moderation queue that surfaces the newest arrival hides
        // the question that has been waiting three weeks.
        orderBy: [asc(blogPostQuestions.priority), desc(blogPostQuestions.createdAt)],
      })
      return serializeQuestions(rows)
    }
  )

  return NextResponse.json({ data, message: "OK" })
}
