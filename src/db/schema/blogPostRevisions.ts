import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { blogPosts } from "./blogPosts"
import { users } from "./users"

/**
 * Point-in-time snapshots of a post's editable body, written on every update.
 *
 * Each row holds the state *before* the edit that created it, so restoring
 * revision N returns the post to how it looked before that save.
 *
 * Only the fields worth recovering are stored — title, excerpt, content.
 * Relations (categories, tags, FAQs) and SEO metadata are deliberately out:
 * they are cheap to re-pick and would triple the row size of a table that
 * already carries up to 50k characters of content per revision. Retention is
 * capped per post (see REVISION_RETENTION) so this cannot grow unbounded.
 */
export const blogPostRevisions = sqliteTable("blog_post_revision", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  postId: text("postId")
    .notNull()
    .references(() => blogPosts.id, { onDelete: "cascade" }),

  title: text("title").notNull(),
  excerpt: text("excerpt").notNull(),
  content: text("content").notNull(),

  /** Who made the edit that produced this snapshot. `restrict`, matching
   *  blogPosts.authorId — deleting an admin should fail loudly, not quietly
   *  shred the edit history that names them. */
  editorId: text("editorId")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),

  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})

/** Kept per post. Content can be 50k characters, so this table would
 *  otherwise dominate the database. */
export const REVISION_RETENTION = 20
