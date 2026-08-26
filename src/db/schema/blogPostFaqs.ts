import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { blogPosts } from "./blogPosts"

export const blogPostFaqs = sqliteTable("blog_post_faq", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  postId: text("postId").notNull().references(() => blogPosts.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  priority: integer("priority").notNull().default(0),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})
