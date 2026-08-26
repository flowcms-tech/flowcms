import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { blogPosts } from "./blogPosts"
import { users } from "./users"

/**
 * Reader questions, moderated, feeding the post's FAQPage markup.
 *
 * This is NOT comments. Comments were ruled out because a business blog
 * attracts spam rather than discussion, and that reasoning still holds. The
 * difference is the output: nothing here is public until an admin has written
 * an answer, so the visible result is a curated Q&A block — the same shape as
 * the hand-authored `blog_post_faq` rows, and it joins them in the same
 * FAQPage graph.
 *
 * No email column, deliberately. Collecting an address implies a reply, and
 * this app has no mail infrastructure to send one with.
 */
export const blogPostQuestions = sqliteTable("blog_post_question", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

  postId: text("postId")
    .notNull()
    .references(() => blogPosts.id, { onDelete: "cascade" }),

  /** Optional — a question is worth answering whether or not it is signed. */
  askerName: text("askerName"),
  question: text("question").notNull(),

  /** Null until answered. A published row without an answer is impossible:
   *  the publish transition requires one. */
  answer: text("answer"),
  answeredById: text("answeredById").references(() => users.id, { onDelete: "set null" }),

  status: text("status", { enum: ["pending", "published", "rejected"] })
    .notNull()
    .default("pending"),

  /** Ordering in the on-page Q&A block and in the FAQPage graph, matching
   *  how `blog_post_faq.priority` already works. */
  priority: integer("priority").notNull().default(0),

  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  answeredAt: integer("answeredAt", { mode: "timestamp_ms" }),
})
