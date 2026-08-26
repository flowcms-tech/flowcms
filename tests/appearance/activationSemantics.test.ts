import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { DEFAULT_THEME_SLUG, isNoOpActivation, normalizeThemeSelection } from "@/Themes/constants"
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, activityEntityHref } from "@/Framework/Activity/activityTypes"

/**
 * The rules the Appearance screen and the activation endpoint must agree about.
 *
 * They are in `@/Themes/constants` rather than in either one, because a button
 * that offers an action the endpoint treats as a no-op — or hides one it would
 * accept — is a bug nobody notices until an operator reports that "the button
 * does nothing".
 */

describe("normalizeThemeSelection", () => {
  it("stores null for the default theme, not the literal string", () => {
    // One representation for "no explicit choice". Phase 6.3 chose null; this
    // is the function that keeps the API honest about it.
    expect(normalizeThemeSelection(DEFAULT_THEME_SLUG)).toBeNull()
  })

  it("stores any other slug as itself", () => {
    expect(normalizeThemeSelection("aurora")).toBe("aurora")
  })
})

describe("isNoOpActivation", () => {
  it("treats activating the already-selected theme as a no-op", () => {
    expect(isNoOpActivation("aurora", "aurora")).toBe(true)
  })

  it("treats activating the default with nothing selected as a no-op", () => {
    // A fresh install: the default is rendering and nothing is stored.
    // Activating it would write null over null.
    expect(isNoOpActivation(DEFAULT_THEME_SLUG, null)).toBe(true)
  })

  it("treats activating the default during a fallback as a REAL change", () => {
    // The recovery path, and the case that makes this a function rather than a
    // comparison against whatever is rendering. The default is on screen
    // because `aurora` is missing; activating it clears the stale selection and
    // the warning with it.
    expect(isNoOpActivation(DEFAULT_THEME_SLUG, "aurora")).toBe(false)
  })

  it("treats activating the default over a legacy literal as a real change", () => {
    // A database written before the null convention can hold "default". Letting
    // the operator normalise it is better than pretending there is nothing to do.
    expect(isNoOpActivation(DEFAULT_THEME_SLUG, "default")).toBe(false)
  })

  it("treats switching themes as a real change", () => {
    expect(isNoOpActivation("aurora", null)).toBe(false)
    expect(isNoOpActivation("aurora", "sunrise")).toBe(false)
  })
})

describe("activity vocabulary", () => {
  it("has an action and an entity type for theme activation", () => {
    // Its own action rather than `updated` on settings: "who changed how the
    // site looks" must be answerable by a filter.
    expect(ACTIVITY_ACTIONS).toContain("activated")
    expect(ACTIVITY_ENTITY_TYPES).toContain("theme")
  })

  it("points a theme entry at the Appearance screen, admin-relative", () => {
    // Admin-relative, because the configured admin path is joined at render.
    const href = activityEntityHref("theme", "aurora")
    expect(href).toBe("/appearance/themes")
    expect(href?.startsWith("/admin")).toBe(false)
  })

  it("needs no migration to store either value", () => {
    // `action` and `entityType` are plain text/varchar columns — the enum is a
    // TypeScript constraint, not a database CHECK — so adding vocabulary is a
    // code change on all four engines. Asserted against the baseline SQL so a
    // future CHECK constraint would fail here rather than at an operator's
    // first activation on PostgreSQL.
    for (const dialect of ["sqlite", "postgresql", "mysql"]) {
      const sql = readFileSync(`src/db/migrations/${dialect}/0000_baseline.sql`, "utf8")
      const table = sql.slice(sql.indexOf("activity_log"))
      const definition = table.slice(0, table.indexOf(");"))
      expect(definition, dialect).not.toMatch(/CHECK/i)
    }
  })
})
