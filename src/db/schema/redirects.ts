import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

/**
 * Site-wide 301s. Deliberately not blog-specific — service pages will need
 * the same thing.
 *
 * Resolved in the page's not-found branch, NOT in `src/proxy.ts`: the proxy
 * must never transitively import the DB client (that separation is the whole
 * reason `auth.config.ts` and `auth.ts` are split). Paying one extra query on
 * the 404 path is the cost of keeping the proxy DB-free.
 */
export const redirects = sqliteTable("redirect", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  /** Absolute path with a leading slash, no origin. e.g. "/blog/old-slug" */
  fromPath: text("fromPath").notNull().unique(),
  toPath: text("toPath").notNull(),
  /**
   * Intent, not the literal wire code. Next's server-component redirect API
   * only emits 308 (permanent) and 307 (temporary), so 301/308 here both
   * become a 308 and 302/307 both become a 307. Google treats 308 and 301 as
   * equivalent for consolidating ranking signals.
   */
  statusCode: integer("statusCode").notNull().default(301),
  /** true when created automatically by a slug change, false when hand-added. */
  isAutomatic: integer("isAutomatic", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})
