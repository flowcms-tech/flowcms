import { sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core"
import { blogPosts } from "./blogPosts"
import { blogCategories } from "./blogCategories"

export const blogPostCategories = sqliteTable("blog_post_category", {
  postId: text("postId").notNull().references(() => blogPosts.id, { onDelete: "cascade" }),
  categoryId: text("categoryId").notNull().references(() => blogCategories.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.postId, table.categoryId] }),
])
