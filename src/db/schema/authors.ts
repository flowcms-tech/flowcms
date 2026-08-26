import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

/**
 * A public byline, deliberately separate from `user`.
 *
 * Intentionally NOT blog-specific: service pages, case studies, and guides all
 * need a credited author, and they should all point at this one table.
 *
 * `blogPosts.createdById` points at the admin account that created the row — an
 * audit trail. This is the person the *reader* sees, and the two are often not
 * the same: a subject-matter expert who never logs in can be the credited author,
 * and a staffer with a panel account may write nothing.
 *
 * The field set is shaped by what Google's E-E-A-T guidance and schema.org
 * `Person` actually consume: a real name, stated expertise (`jobTitle`,
 * `credentials`), a description, an image, and `sameAs` profile links — the
 * strongest signal that a byline is a real, verifiable person rather than a
 * content-farm placeholder.
 */
export const authors = sqliteTable("author", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

  name: text("name").notNull(),
  /** Reserved for the future /blog/author/[slug] page. Unique from day one so
   *  those URLs are stable once that page exists. */
  slug: text("slug").notNull().unique(),

  // -- E-E-A-T ---------------------------------------------------------------
  /** schema.org Person.jobTitle — e.g. "Senior Editor", "Service Manager". */
  jobTitle: text("jobTitle"),
  /** Licence number, years of experience, trade association memberships. */
  credentials: text("credentials"),
  /** schema.org Person.description. One or two sentences. */
  bio: text("bio"),

  avatarKey: text("avatarKey"),
  avatarAltText: text("avatarAltText"),

  email: text("email"),

  // -- sameAs ----------------------------------------------------------------
  // Discrete columns rather than a JSON blob, matching how blogCategories
  // stores its SEO fields. Assembled into a schema.org `sameAs` array at
  // render time, skipping the blanks.
  websiteUrl: text("websiteUrl"),
  linkedinUrl: text("linkedinUrl"),
  twitterUrl: text("twitterUrl"),
  facebookUrl: text("facebookUrl"),
  instagramUrl: text("instagramUrl"),

  // -- SEO for the future author page ---------------------------------------
  metaTitle: text("metaTitle"),
  metaDescription: text("metaDescription"),
  canonicalUrl: text("canonicalUrl"),
  isIndexable: integer("isIndexable", { mode: "boolean" }).notNull().default(true),

  isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),

  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})
