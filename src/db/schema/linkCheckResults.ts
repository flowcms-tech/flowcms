import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { blogPosts } from "./blogPosts"

/**
 * Results of the broken-link scan, one row per (post, url) per scan.
 *
 * Scans are triggered by hand from the SEO audit screen, never on a timer —
 * there is no cron in this app, and the trash spec already established why
 * running background work on whichever visitor happens to load a page is a
 * pattern to avoid.
 *
 * `result` is deliberately wider than ok/broken. Many sites answer automated
 * requests with 403 or 999, which is not the same as being dead, and a
 * checker that reports those as "broken" gets ignored within a week — at
 * which point it is worse than no checker, because the real broken links are
 * now hidden in a list nobody reads.
 */
export const linkCheckResults = sqliteTable("link_check_result", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

  postId: text("postId")
    .notNull()
    .references(() => blogPosts.id, { onDelete: "cascade" }),

  url: text("url").notNull(),
  isInternal: integer("isInternal", { mode: "boolean" }).notNull(),

  /** Null for internal links, which are resolved against the DB with no
   *  HTTP request at all. */
  statusCode: integer("statusCode"),

  result: text("result", {
    enum: ["ok", "broken", "redirect", "timeout", "unverifiable"],
  }).notNull(),

  checkedAt: integer("checkedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})
