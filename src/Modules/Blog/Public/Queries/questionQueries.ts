import { and, asc, eq, isNotNull, ne } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPostQuestions } from "@/db/tables"
import type { PublicPostQuestion } from "@/Themes/contract/views"

/** Defined on the theme contract since Phase 7.2 — it is what a theme renders,
 *  so the published package has to declare it. Re-exported here because every
 *  existing caller imports it from this module. */
export type { PublicPostQuestion } from "@/Themes/contract/views"

/**
 * The published Q&A for a post, in render order.
 *
 * Three conditions, not one, and each is load-bearing:
 *  - `status = "published"` is the moderation decision;
 *  - `answer IS NOT NULL` and non-empty is the correctness rule — the API
 *    refuses to publish an unanswered question, and this is the belt to that
 *    braces. A `Question` node with an empty `acceptedAnswer` is invalid
 *    structured data, and the cost of being wrong is a manual action.
 *
 * Ordered by `priority` then oldest-first, matching how `blog_post_faq` already
 * orders, so the two lists interleave predictably when they are concatenated.
 */
export async function getPublishedQuestionsForPost(postId: string): Promise<PublicPostQuestion[]> {
  const rows = await db.query.blogPostQuestions.findMany({
    where: and(
      eq(blogPostQuestions.postId, postId),
      eq(blogPostQuestions.status, "published"),
      isNotNull(blogPostQuestions.answer),
      ne(blogPostQuestions.answer, "")
    ),
    orderBy: [asc(blogPostQuestions.priority), asc(blogPostQuestions.createdAt)],
  })

  return rows.map((row) => ({
    id: row.id,
    question: row.question,
    // The `isNotNull` filter above makes this safe; the fallback exists so a
    // future change to that query degrades to an empty string rather than
    // emitting `null` into the page.
    answer: row.answer ?? "",
    askerName: row.askerName,
  }))
}
