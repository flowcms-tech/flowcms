import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

/**
 * Paths that 404'd, so a broken inbound link can become a redirect.
 *
 * One row per path with a counter, NOT a row per hit. A row per hit would
 * mean a write on every scanner request, and scanners are most 404 traffic —
 * the table would grow without bound while burying the handful of paths that
 * represent real broken links.
 *
 * For the same reason the logging endpoint drops known scanner probes
 * (`wp-*`, `.php`, `.env`, `xmlrpc`, …) before they ever reach this table.
 * Those are not broken links; they are noise that would drown the signal.
 */
export const notFoundLog = sqliteTable("not_found_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

  /** Absolute path with a leading slash, query string stripped. Unique — the
   *  `hits` counter is what distinguishes a one-off typo from a live broken
   *  link someone is publishing. */
  path: text("path").notNull().unique(),
  hits: integer("hits").notNull().default(1),

  /** Where the last hit came from. Usually the most useful field on the row:
   *  it tells you whether the bad link is yours or someone else's. */
  lastReferrer: text("lastReferrer"),

  /**
   * Set when a redirect is created for this path. The row is kept rather
   * than deleted — the whole question after fixing a 404 is "did the hits
   * stop", and a deleted row cannot answer it.
   */
  resolvedAt: integer("resolvedAt", { mode: "timestamp_ms" }),

  firstSeenAt: integer("firstSeenAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  lastSeenAt: integer("lastSeenAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})
