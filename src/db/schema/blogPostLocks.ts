import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { blogPosts } from "./blogPosts"
import { users } from "./users"

/**
 * "Someone else is editing this" locks, one row per post.
 *
 * Deliberately a separate table from `blogPosts` rather than a couple of
 * nullable columns on it: a lock is refreshed by a heartbeat every ~20s
 * while the edit page is open, and that write must never touch the post's
 * own `updatedAt` or trip the revision-snapshot logic in the PATCH route —
 * those track content changes, not who has a tab open.
 *
 * `postId` is the primary key, not a separate `id`: there is at most one
 * lock per post, and acquiring is an upsert keyed on exactly that.
 */
export const blogPostLocks = sqliteTable("blog_post_lock", {
  postId: text("postId")
    .primaryKey()
    .references(() => blogPosts.id, { onDelete: "cascade" }),
  lockedById: text("lockedById")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  lockedAt: integer("lockedAt", { mode: "timestamp_ms" }).notNull(),
})
