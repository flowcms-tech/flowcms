import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const users = sqliteTable("user", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  image: text("image"),
  passwordHash: text("passwordHash"),
  isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),
  /**
   * Editorial capability, distinct from `isActive` (which is "can log in at
   * all"). Enforced in the route handlers, never only by hiding a button.
   *
   * Defaults to "contributor" — the LEAST privileged role.
   *
   * It defaulted to "admin" originally, so that accounts predating this column
   * (created when there were no roles, and holding full rights) would not
   * silently lose permissions when the migration ran. That was a one-time
   * migration concern and it has been served.
   *
   * A permissive default is the wrong shape for software other people install:
   * any insert that omits the role — a future code path, a manual fix, a
   * restored backup — would mint an administrator. It also has to agree with
   * `resolveRole`'s fallback, or a token refresh would change what a user can
   * do; both are now "contributor".
   *
   * The seed script sets the first account to "owner" explicitly, and the
   * admin-users route always sends a role, so nothing legitimate relies on
   * this default.
   */
  role: text("role", { enum: ["owner", "admin", "editor", "contributor"] })
    .notNull()
    .default("contributor"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})
