import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { users } from "./users"
import { authors } from "./authors"
import { blogCategories } from "./blogCategories"
import { blogSeries } from "./blogSeries"

export const blogPosts = sqliteTable("blog_post", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  excerpt: text("excerpt").notNull(),
  content: text("content").notNull(),
  featuredImageKey: text("featuredImageKey").notNull(),
  /** The admin account that created the post — an audit trail, never shown to
   *  readers. Predates the Authors module, which is why it holds the plain
   *  `authorId` name; the API exposes it as `createdBy` to keep the
   *  reader-facing meaning of "author" unambiguous. */
  authorId: text("authorId").notNull().references(() => users.id, { onDelete: "restrict" }),
  /** The public byline, from the shared `author` table. Named authorProfileId
   *  because `authorId` above was already taken. Nullable: rows created before
   *  the Authors module have none, and the public layer falls back to the
   *  creating admin's name. `set null` — losing an author must never delete
   *  published posts. */
  authorProfileId: text("authorProfileId").references(() => authors.id, { onDelete: "set null" }),
  isPublished: integer("isPublished", { mode: "boolean" }).notNull().default(false),
  publishedAt: integer("publishedAt", { mode: "timestamp_ms" }),
  // Admin-set target time for auto-publish. Distinct from publishedAt (which
  // is the historical "first went live" timestamp, preserved even after
  // unpublishing) — this is only ever set for a pending future publish and
  // is cleared once consumed or manually unpublished, so it can never cause
  // a previously-unpublished post to auto-republish itself.
  scheduledPublishAt: integer("scheduledPublishAt", { mode: "timestamp_ms" }),
  metaTitle: text("metaTitle"),
  metaDescription: text("metaDescription"),
  canonicalUrl: text("canonicalUrl"),
  /** Alt text for featuredImageKey. Nullable so this migration applies to
   *  existing rows; Zod requires it on create so no new gaps appear. */
  featuredImageAltText: text("featuredImageAltText"),
  /** Optional 1200x630 social image. Falls back to featuredImageKey. */
  ogImageKey: text("ogImageKey"),
  /** false emits a noindex robots tag and drops the post from sitemap.xml.
   *  The post stays publicly reachable — this only hides it from search. */
  isIndexable: integer("isIndexable", { mode: "boolean" }).notNull().default(true),

  // -- Focus keyword and analysis --------------------------------------------
  /** The single query this post is written to rank for. Without a stated
   *  target, no on-page analysis is possible — this is the field the whole
   *  SEO panel hangs off. */
  focusKeyword: text("focusKeyword"),
  /** Up to 4 supporting terms, JSON array of strings. A join table for
   *  free-text keywords with no identity of their own would be ceremony:
   *  nothing ever queries one, and they are written and read as a unit. */
  secondaryKeywords: text("secondaryKeywords"),
  /** 0-100, recomputed on every write by the shared analyser. Stored ONLY so
   *  the posts list and audit dashboard can sort and filter without parsing
   *  every post's HTML per request. Never the source of truth — the analyser
   *  is, and it is re-run wherever the number is actually shown. */
  seoScore: integer("seoScore"),
  readabilityScore: integer("readabilityScore"),

  // -- Content structure ------------------------------------------------------
  /** Word count of the rendered text, computed on write alongside the
   *  existing excerpt suggestion. Reading time is derived at render
   *  (ceil(wordCount / 200)) and deliberately not stored — one number, one
   *  source of truth, and the divisor stays tunable without a migration. */
  wordCount: integer("wordCount"),
  /**
   * Set only when the editor ticks "this is a substantive update".
   *
   * NOT `updatedAt`, which bumps on a typo fix. `dateModified`, the
   * sitemap's `lastModified`, and the visible "Last updated" line all read
   * `contentUpdatedAt ?? publishedAt` — re-dating unchanged content is
   * exactly the pattern Google treats as manipulative, so the honest signal
   * has to be a separate, deliberately-set field.
   */
  contentUpdatedAt: integer("contentUpdatedAt", { mode: "timestamp_ms" }),
  /** Pillar content. Ranks above ordinary posts in related-post scoring and
   *  gets its own cluster view. Yoast calls this "cornerstone". */
  isCornerstone: integer("isCornerstone", { mode: "boolean" }).notNull().default(false),
  seriesId: text("seriesId").references(() => blogSeries.id, { onDelete: "set null" }),
  seriesPosition: integer("seriesPosition"),

  // -- Taxonomy ---------------------------------------------------------------
  /**
   * Drives the breadcrumb trail, `BlogPosting.articleSection`, and
   * related-post scoring.
   *
   * Nullable rather than backfilled: the render path falls back to the
   * alphabetically-first linked category, which is deterministic. The current
   * behaviour without this column picks whichever category row comes back
   * first, so the breadcrumb can change between deploys for no reason.
   *
   * `set null` — losing a category must never orphan the post.
   */
  primaryCategoryId: text("primaryCategoryId").references(() => blogCategories.id, {
    onDelete: "set null",
  }),

  // -- Structured data --------------------------------------------------------
  /** Which schema.org type this post's main entity is. */
  schemaType: text("schemaType", {
    enum: ["BlogPosting", "Article", "NewsArticle", "HowTo", "Review", "VideoObject"],
  })
    .notNull()
    .default("BlogPosting"),
  /**
   * Type-specific payload — HowTo steps and tools, Review item and rating,
   * VideoObject url and duration. JSON rather than five sparse tables: the
   * shape is dictated entirely by `schemaType`, it is written and read as one
   * unit, and nothing ever queries inside it. Validated at the API edge by a
   * discriminated-union Zod schema, so it stays typed where it matters.
   */
  schemaData: text("schemaData"),
  /** CSS selectors for the sentences worth reading aloud by a voice
   *  assistant, JSON array. Defaults are applied at render; the column exists
   *  so the selector isn't hardcoded against a template that will change. */
  speakableSelectors: text("speakableSelectors"),

  // -- Editorial workflow -----------------------------------------------------
  /**
   * Approval state, deliberately ORTHOGONAL to `isPublished`.
   *
   * Reworking `isPublished` into a status enum is the one migration on the
   * previous spec's list that needs a backfill and a dual-write period, and
   * it is out of scope here. It is also the wrong model: a post written by an
   * editor is published and has never needed review, which is `"none"`, not a
   * missing state.
   */
  reviewStatus: text("reviewStatus", {
    enum: ["none", "pending", "approved", "rejected"],
  })
    .notNull()
    .default("none"),
  reviewedById: text("reviewedById").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: integer("reviewedAt", { mode: "timestamp_ms" }),
  /** Why it was rejected. Shown to the contributor on their edit screen — a
   *  rejection with no reason just produces a resubmission of the same post. */
  reviewNote: text("reviewNote"),
  /** Trash. Non-null means the post is in the trash: hidden from the admin
   *  list and the public site, but fully restorable. Nothing in the app hard
   *  deletes a post except an explicit "delete permanently" action — a single
   *  confirm click must never be able to destroy content plus its FAQs and
   *  category/tag links. */
  deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})
