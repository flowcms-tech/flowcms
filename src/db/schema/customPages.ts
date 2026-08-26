import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { users } from "./users"

/**
 * Standalone content pages with an admin-chosen URL — privacy policy,
 * terms, etc. Deliberately lean: no categories/tags/review-workflow like
 * blogPosts, since this table exists precisely for content that isn't part
 * of the blog.
 */
export const customPages = sqliteTable("custom_page", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  /** Absolute path with a leading slash, e.g. "/privacy-policy" or
   *  "/legal/terms-of-service". Globally unique. */
  path: text("path").notNull().unique(),
  content: text("content").notNull(),
  metaTitle: text("metaTitle"),
  metaDescription: text("metaDescription"),
  canonicalUrl: text("canonicalUrl"),
  ogImageKey: text("ogImageKey"),
  isIndexable: integer("isIndexable", { mode: "boolean" }).notNull().default(true),
  isPublished: integer("isPublished", { mode: "boolean" }).notNull().default(false),
  /** Set once on first publish, kept across unpublish/republish — the
   *  "was this path ever live" signal that decides whether a path rename
   *  needs an automatic redirect. */
  publishedAt: integer("publishedAt", { mode: "timestamp_ms" }),
  createdById: text("createdById").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})
