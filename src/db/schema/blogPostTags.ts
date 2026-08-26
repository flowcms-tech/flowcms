import { sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core"
import { blogPosts } from "./blogPosts"
import { blogTags } from "./blogTags"

export const blogPostTags = sqliteTable("blog_post_tag", {
  postId: text("postId").notNull().references(() => blogPosts.id, { onDelete: "cascade" }),
  tagId: text("tagId").notNull().references(() => blogTags.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.postId, table.tagId] }),
])
