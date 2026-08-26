import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

/**
 * Operator-chosen values for one theme's declared settings.
 *
 * ONE ROW PER THEME SLUG, and the slug is the primary key. Settings belong to a
 * theme, not to "the active theme": configuring a theme you have not switched
 * to is a thing operators do, and switching themes must never delete, reset or
 * copy anything. Every isolation guarantee in Phase 6.6 rests on this key.
 *
 * NO FOREIGN KEY, deliberately. There is no `installed_themes` table to
 * reference — what is installed is a property of the build artifact, not
 * relational data (see the theme system section of dev-docs/architecture/PROJECT_DOCUMENTATION.md). A
 * row for a theme this build no longer contains is preserved and simply not
 * used: reinstalling the theme makes it meaningful again, and deleting it
 * because the code moved would be destroying an operator's work.
 *
 * THEME CODE IS NEVER STORED HERE. This table holds values, nothing else.
 */
export const themeSettings = sqliteTable("theme_settings", {
  /** The theme's manifest slug. Primary key: one settings namespace per theme. */
  themeSlug: text("themeSlug").primaryKey(),

  /**
   * The values, as JSON text.
   *
   * TEXT rather than a native JSON column because FlowCMS supports four
   * engines whose JSON types differ in storage, comparison and returned shape.
   * One logical format with core-owned parsing keeps behaviour identical
   * everywhere, and nothing queries inside this column — it is read whole,
   * parsed once, and validated field by field against the theme's definition.
   *
   * Not named `values`: that is a reserved word in MySQL and PostgreSQL, and
   * while Drizzle quotes identifiers, a column nobody can select in a psql
   * session without quoting is a column that wastes somebody's afternoon.
   */
  settingsJson: text("settingsJson").notNull(),

  /**
   * The theme's settings-definition version at the time these values were
   * saved — NOT the theme's semver.
   *
   * Persisted rather than inferred so core can tell an old row from a current
   * one without guessing. On a mismatch the row is preserved and resolved as
   * far as the current definition allows; see `resolveSettingsRow`.
   */
  schemaVersion: integer("schemaVersion").notNull().default(1),

  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})
