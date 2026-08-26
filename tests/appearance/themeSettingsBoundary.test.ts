// MUST be first: it sets DATABASE_URL before `@/db/client` reads it.
import { DB_DIALECT, DB_URL } from "../themes/activationEnv"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { themeSettings, activityLog } from "@/db/tables"
import {
  getThemeSettings,
  setThemeSettings,
  resetThemeSettings,
} from "@/Framework/Settings/themeSettings"
import { MAX_SETTINGS_BYTES } from "@/Framework/Settings/themeSettingsResolve"
import { defaultThemeSettings } from "@/Themes/default/settings"

/** The declared default for one field, read from the theme itself. */
function declaredDefault(key: string) {
  const field = defaultThemeSettings.fields.find((f) => f.key === key)
  if (!field) throw new Error(`no such field: ${key}`)
  return field.default
}

/**
 * The theme-settings domain service, against a real database.
 *
 * Tables come from `@/db/tables` — the runtime facade the application uses —
 * so this exercises the production query-construction path (Phase 5.2), not a
 * test-only one.
 *
 * SQLite by default. The other three run when pointed at a real engine:
 *
 *   TEST_ACTIVATION_DIALECT=postgresql TEST_ACTIVATION_URL=postgresql://… \
 *     npx vitest run tests/appearance/themeSettingsBoundary.test.ts
 */

beforeAll(async () => {
  if (DB_DIALECT === "sqlite") {
    const { createClient } = await import("@libsql/client")
    const { drizzle } = await import("drizzle-orm/libsql")
    const { migrate } = await import("drizzle-orm/libsql/migrator")
    const client = createClient({ url: DB_URL })
    try {
      await migrate(drizzle(client), { migrationsFolder: "src/db/migrations/sqlite" })
    } finally {
      client.close()
    }
  }
  await db.delete(themeSettings)
  await db.delete(activityLog).where(eq(activityLog.entityType, "theme_settings"))
  // No user cleanup: this suite creates none, and deleting every user fails on
  // MySQL/MariaDB where a leftover custom_page still references one through an
  // ON DELETE RESTRICT foreign key. A shared test database must only clear what
  // the suite itself owns.
}, 120_000)

beforeEach(async () => {
  await db.delete(themeSettings)
})

async function rowFor(slug: string) {
  const [row] = await db.select().from(themeSettings).where(eq(themeSettings.themeSlug, slug))
  return row
}

describe(`theme settings — no row — ${DB_DIALECT}`, () => {
  it("resolves the default theme to its declared defaults", async () => {
    const resolved = await getThemeSettings("default")
    expect(resolved.stored).toBe(false)
    expect(resolved.issues).toEqual([])
    expect(Object.keys(resolved.values).length).toBeGreaterThan(0)
  })

  it("writes nothing while reading", async () => {
    await getThemeSettings("default")
    expect(await rowFor("default")).toBeUndefined()
  })
})

describe(`theme settings — strict write — ${DB_DIALECT}`, () => {
  it("saves valid values and reports the change", async () => {
    const result = await setThemeSettings("default", { showTagline: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(true)

    const resolved = await getThemeSettings("default")
    expect(resolved.values.showTagline).toBe(true)
    expect(resolved.stored).toBe(true)
  })

  it("persists the definition version alongside the values", async () => {
    await setThemeSettings("default", { showTagline: true })
    const row = await rowFor("default")
    expect(row.schemaVersion).toBeGreaterThanOrEqual(1)
    const resolved = await getThemeSettings("default")
    expect(row.schemaVersion).toBe(resolved.definitionVersion)
  })

  it("stores canonical JSON, not the raw request", async () => {
    await setThemeSettings("default", { showTagline: true })
    const row = await rowFor("default")
    expect(() => JSON.parse(row.settingsJson)).not.toThrow()
    expect(JSON.parse(row.settingsJson)).toMatchObject({ showTagline: true })
  })

  it("refuses a slug that is not well formed", async () => {
    const result = await setThemeSettings("NOT A SLUG", {})
    expect(result.ok).toBe(false)
  })

  it("refuses a theme this build does not contain", async () => {
    const result = await setThemeSettings("aurora-nightfall", {})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/installed/i)
  })

  it("refuses an unknown setting key", async () => {
    const result = await setThemeSettings("default", { notAField: true })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/notAField/)
  })

  it("refuses a value of the wrong type", async () => {
    const result = await setThemeSettings("default", { showTagline: "yes" })
    expect(result.ok).toBe(false)
  })

  it("refuses a payload above the size ceiling", async () => {
    const huge = "x".repeat(MAX_SETTINGS_BYTES + 1000)
    const result = await setThemeSettings("default", { showTagline: false, huge })
    expect(result.ok).toBe(false)
  })

  it("writes nothing when it refuses", async () => {
    await setThemeSettings("default", { notAField: true })
    expect(await rowFor("default")).toBeUndefined()
  })
})

describe(`theme settings — no-op — ${DB_DIALECT}`, () => {
  it("reports changed:false and does not touch updatedAt", async () => {
    await setThemeSettings("default", { showTagline: true })
    const before = await rowFor("default")

    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await setThemeSettings("default", { showTagline: true })

    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.changed).toBe(false)

    const after = await rowFor("default")
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
  })
})

describe(`theme settings — unknown historical keys — ${DB_DIALECT}`, () => {
  it("carries an unknown stored key through a save rather than destroying it", async () => {
    // A key from a newer or older version of the theme. The current build
    // cannot render it; deleting it would be data loss by upgrade.
    const now = new Date()
    await db.insert(themeSettings).values({
      themeSlug: "default",
      settingsJson: JSON.stringify({ fromAnotherVersion: "keep me", showTagline: true }),
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    })

    await setThemeSettings("default", { showTagline: true })

    const row = await rowFor("default")
    const stored = JSON.parse(row.settingsJson)
    expect(stored.fromAnotherVersion).toBe("keep me")
    expect(stored.showTagline).toBe(true)
  })

  it("still keeps the unknown key out of what the theme receives", async () => {
    const resolved = await getThemeSettings("default")
    expect("fromAnotherVersion" in resolved.values).toBe(false)
  })
})

describe(`theme settings — reset — ${DB_DIALECT}`, () => {
  it("deletes the row rather than storing a copy of the defaults", async () => {
    await setThemeSettings("default", { showTagline: true })
    const result = await resetThemeSettings("default")

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(true)
    expect(await rowFor("default")).toBeUndefined()
  })

  it("resolves back to the theme defaults afterwards", async () => {
    await setThemeSettings("default", { showTagline: true })
    await resetThemeSettings("default")
    const resolved = await getThemeSettings("default")
    expect(resolved.stored).toBe(false)
    expect(resolved.values.showTagline).toBe(declaredDefault("showTagline"))
  })

  it("is a no-op when there is nothing stored", async () => {
    const result = await resetThemeSettings("default")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(false)
  })
})

describe(`theme settings — per-theme isolation — ${DB_DIALECT}`, () => {
  it("keeps each theme's settings in its own row", async () => {
    await setThemeSettings("default", { showTagline: true })
    await setThemeSettings("integration", { markerSuffix: "alpha" })

    const defaults = await getThemeSettings("default")
    const integration = await getThemeSettings("integration")

    expect(defaults.values.showTagline).toBe(true)
    expect(integration.values.markerSuffix).toBe("alpha")
    // No key bleeds across the boundary.
    expect("markerSuffix" in defaults.values).toBe(false)
    expect("showTagline" in integration.values).toBe(false)
  })

  it("leaves the other theme's row untouched when one is written", async () => {
    await setThemeSettings("default", { showTagline: true })
    await setThemeSettings("integration", { markerSuffix: "alpha" })
    const before = await rowFor("default")

    await setThemeSettings("integration", { markerSuffix: "beta" })

    const after = await rowFor("default")
    expect(after.settingsJson).toBe(before.settingsJson)
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
  })

  it("leaves the other theme's row untouched when one is reset", async () => {
    await setThemeSettings("default", { showTagline: true })
    await setThemeSettings("integration", { markerSuffix: "alpha" })

    await resetThemeSettings("integration")

    expect(await rowFor("default")).toBeDefined()
    expect((await getThemeSettings("default")).values.showTagline).toBe(true)
  })
})

describe(`theme settings — a row for a theme this build lacks — ${DB_DIALECT}`, () => {
  it("is preserved and never sent to rendering", async () => {
    const now = new Date()
    await db.insert(themeSettings).values({
      themeSlug: "aurora-nightfall",
      settingsJson: JSON.stringify({ anything: 1 }),
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    })

    // Reading the uninstalled theme resolves to nothing renderable…
    const resolved = await getThemeSettings("aurora-nightfall")
    expect(resolved.values).toEqual({})

    // …and the row is still there afterwards.
    expect(await rowFor("aurora-nightfall")).toBeDefined()
  })
})

describe(`theme settings — corrupt row — ${DB_DIALECT}`, () => {
  it("resolves to defaults, reports an issue, and leaves the row alone", async () => {
    const now = new Date()
    await db.insert(themeSettings).values({
      themeSlug: "default",
      settingsJson: "{ this is not json",
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    })

    const resolved = await getThemeSettings("default")
    expect(resolved.values.showTagline).toBe(declaredDefault("showTagline"))
    expect(resolved.issues.some((issue) => issue.kind === "corrupt-json")).toBe(true)

    const row = await rowFor("default")
    expect(row.settingsJson).toBe("{ this is not json")
  })
})

describe(`theme settings — unicode — ${DB_DIALECT}`, () => {
  it("round-trips non-ASCII text exactly", async () => {
    const value = "Καλημέρα — 日本語 — emoji 🎨"
    const result = await setThemeSettings("integration", { markerSuffix: value })
    expect(result.ok).toBe(true)
    const resolved = await getThemeSettings("integration")
    expect(resolved.values.markerSuffix).toBe(value)
  })
})
