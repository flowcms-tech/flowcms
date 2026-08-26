import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

/**
 * A multi-part series — "Choosing a Lock, Part 2 of 4".
 *
 * Deliberately its own table rather than a reused tag: a series has an
 * *order*, and `blog_post_tag` is a set with no position column. Ordering is
 * the entire point (a reader landing on part 3 needs a route to parts 1, 2
 * and 4), so it cannot be bolted onto a taxonomy that has no concept of it.
 *
 * There is no `/blog/series/[slug]` archive yet — see the spec. The in-post
 * navigation strip carries most of the value, and a fourth archive type
 * brings its own metadata, sitemap entries, and noindex rules.
 */
export const blogSeries = sqliteTable("blog_series", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

  name: text("name").notNull(),
  /** Unique from day one so the future archive URLs are stable, exactly as
   *  `author.slug` was reserved before its page existed. */
  slug: text("slug").notNull().unique(),
  description: text("description"),

  isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),

  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})
