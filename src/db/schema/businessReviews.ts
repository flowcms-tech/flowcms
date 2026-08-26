import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

/**
 * Real customer reviews, entered by an admin, backing the site's
 * `AggregateRating` markup.
 *
 * ⚠️ READ BEFORE ADDING A SEED OR DEMO ROW.
 *
 * `LocalBusinessJsonLd` currently omits `aggregateRating` entirely, with a
 * comment stating that the business has no reviews and that marking up
 * placeholder testimonials as real ratings would be structured-data spam, a
 * manual-action risk, and a misrepresentation under the Competition Act.
 * That reasoning is correct and this table does not weaken it — it exists so
 * that markup becomes possible once genuine reviews exist, not so it can be
 * switched on early.
 *
 * The rules that make the markup defensible are enforced in code, not left to
 * discipline:
 *  - `AggregateRating` is emitted only at 3+ published rows.
 *  - `ratingValue` is computed from these rows. There is deliberately no
 *    settings field to type an average into by hand.
 *  - `source` is required, so every published row records where it came from.
 *  - Reviews render on the page wherever the markup is emitted. Marking up
 *    what a visitor cannot see is what Google penalises.
 */
export const businessReviews = sqliteTable("business_review", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

  authorName: text("authorName").notNull(),
  /** 1-5. Range enforced in Zod — SQLite CHECK constraints are not
   *  expressible through Drizzle's sqliteTable here. */
  rating: integer("rating").notNull(),
  body: text("body"),

  /** "Google", "Facebook", "collected directly" — the audit trail. */
  source: text("source").notNull(),
  sourceUrl: text("sourceUrl"),

  /** When the customer left it, not when it was typed in here. */
  reviewedAt: integer("reviewedAt", { mode: "timestamp_ms" }).notNull(),

  isPublished: integer("isPublished", { mode: "boolean" }).notNull().default(false),

  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})
