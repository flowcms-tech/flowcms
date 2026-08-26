import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { users } from "./users"

/**
 * Manual tracking log for Google Manual Actions and Security Issues.
 *
 * Not automated — no public API exposes either, for anyone. This table exists
 * so a staff member who checks the real Search Console UI has somewhere to
 * record what they found and whether it's resolved, instead of that
 * knowledge living only in someone's memory or a Slack thread.
 */
export const searchConsoleIssues = sqliteTable("search_console_issue", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  type: text("type", { enum: ["manual_action", "security_issue"] }).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  /** Nullable — most manual actions/security issues are site-wide, not
   *  tied to one page. Populated, it's what lets the Page Profile view
   *  join an issue to the URL it's about. */
  url: text("url"),
  /** When the issue was actually detected in Search Console — distinct from
   *  createdAt, which is only when someone logged it here. */
  detectedAt: integer("detectedAt", { mode: "timestamp_ms" }),
  status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
  resolvedAt: integer("resolvedAt", { mode: "timestamp_ms" }),
  notes: text("notes"),
  /** `set null`, not `restrict` — deleting a staff account must never block
   *  on issues they once logged; the entry (and the activity log entry
   *  describing it) outlives the account. */
  createdBy: text("createdBy").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})
