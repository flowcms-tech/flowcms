import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const blogTags = sqliteTable("blog_tag", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  metaTitle: text("metaTitle"),
  metaDescription: text("metaDescription"),
  canonicalUrl: text("canonicalUrl"),
  /** false emits noindex on this archive and drops it from the sitemap.
   *  Tag archives are the most common source of thin indexed pages, so this
   *  matters more here than on categories. */
  isIndexable: integer("isIndexable", { mode: "boolean" }).notNull().default(true),
  /** Intro copy rendered above the post grid, page 1 only. */
  archiveIntro: text("archiveIntro"),
  isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})
