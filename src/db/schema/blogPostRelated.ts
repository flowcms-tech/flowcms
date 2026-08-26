import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core"
import { blogPosts } from "./blogPosts"

/**
 * Manual "related posts" overrides.
 *
 * Related posts are scored automatically from shared categories, tags, and
 * series (see `src/Modules/Blog/Public/Values/relatedPosts.ts`) — that works
 * with zero admin effort and covers every old post. This table exists only
 * for the cases where the editor knows better, and manual rows win entirely
 * when present rather than being blended with the automatic ones: a
 * half-honoured override is worse than none, because the editor cannot tell
 * whether their choice took effect.
 *
 * Both sides cascade — a deleted post must not leave a row pointing at
 * nothing. Self-reference is rejected at the API, not by a constraint;
 * SQLite cannot express a CHECK across the two columns portably through
 * Drizzle.
 */
export const blogPostRelated = sqliteTable(
  "blog_post_related",
  {
    postId: text("postId")
      .notNull()
      .references(() => blogPosts.id, { onDelete: "cascade" }),
    relatedPostId: text("relatedPostId")
      .notNull()
      .references(() => blogPosts.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.postId, t.relatedPostId] })]
)
