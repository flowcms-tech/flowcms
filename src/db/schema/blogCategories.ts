import { sqliteTable, text, integer, type AnySQLiteColumn } from "drizzle-orm/sqlite-core"

export const blogCategories = sqliteTable("blog_category", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  parentId: text("parentId").references((): AnySQLiteColumn => blogCategories.id, { onDelete: "set null" }),
  imageKey: text("imageKey"),
  metaTitle: text("metaTitle"),
  metaDescription: text("metaDescription"),
  ogImageKey: text("ogImageKey"),
  canonicalUrl: text("canonicalUrl"),
  /** false emits noindex on this archive and drops it from the sitemap. The
   *  archive stays publicly reachable — separate from `isActive`, which
   *  hides the category from the site entirely. */
  isIndexable: integer("isIndexable", { mode: "boolean" }).notNull().default(true),
  /** Intro copy rendered above the post grid, page 1 only. An archive with a
   *  heading and a grid is a list Google has no reason to rank; 150 words of
   *  genuine copy makes it a page. */
  archiveIntro: text("archiveIntro"),
  isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})
