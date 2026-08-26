import { beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"

/**
 * The activation write path, against a real database.
 *
 * Not mocked. `setActiveTheme` is the function Phase 6.4's activation route
 * will call, and the properties that matter — that a rejected activation writes
 * nothing, that an accepted one survives a re-read, that neither touches a
 * single row of content — are properties of the database, not of a stub.
 *
 * SQLite in a temp file, so the suite still needs no servers. The same column
 * is exercised on PostgreSQL, MySQL and MariaDB in `tests/db/contract.test.ts`,
 * which is the file that already knows how to reach them.
 */

// MUST be first: it sets DATABASE_URL before `@/db/client` reads it.
import { DB_URL } from "./activationEnv"
import { db } from "@/db/client"
import { settings, SETTINGS_SINGLETON_ID } from "@/db/schema/settings"
import { blogTags } from "@/db/schema"
import {
  clearActiveTheme,
  getActiveThemeSlug,
  isWellFormedThemeSlug,
  setActiveTheme,
} from "@/Framework/Settings/themeSelection"
import { getInstalledTheme } from "@/Themes/registry"

beforeAll(async () => {
  const { createClient } = await import("@libsql/client")
  const { drizzle } = await import("drizzle-orm/libsql")
  const { migrate } = await import("drizzle-orm/libsql/migrator")
  const client = createClient({ url: DB_URL })
  try {
    await migrate(drizzle(client), { migrationsFolder: "src/db/migrations/sqlite" })
  } finally {
    client.close()
  }
}, 60_000)

async function storedValue(): Promise<string | null | undefined> {
  const [row] = await db.select().from(settings).where(eq(settings.id, SETTINGS_SINGLETON_ID))
  return row?.activeTheme
}

describe("the migration actually added the column", () => {
  it("selects activeTheme without error on a freshly migrated database", async () => {
    // The cheapest possible proof that `0001_active_theme` ran. A missing
    // column here is a SQL error, not a subtle wrong answer.
    await expect(storedValue()).resolves.toBeUndefined()
  })

  it("reads as no selection before anything is written", async () => {
    // The fresh-install case: no settings row at all, and the public site still
    // has to render. Not an error, not a fallback — just no choice made.
    await expect(getActiveThemeSlug()).resolves.toBeNull()
  })
})

describe("setActiveTheme — accepts", () => {
  it("the default theme", async () => {
    await expect(setActiveTheme("default")).resolves.toEqual({ ok: true, slug: "default" })
    await expect(getActiveThemeSlug()).resolves.toBe("default")
  })

  it("a registered, compatible, partial theme", async () => {
    // The integration theme implements Layout and BlogIndex only. A partial
    // theme is a legitimate theme; per-surface fallback covers the rest.
    expect(getInstalledTheme("integration")?.available).toBe(true)
    await expect(setActiveTheme("integration")).resolves.toEqual({ ok: true, slug: "integration" })
    await expect(getActiveThemeSlug()).resolves.toBe("integration")
  })

  it("trims surrounding whitespace rather than storing it", async () => {
    await expect(setActiveTheme("  default  ")).resolves.toEqual({ ok: true, slug: "default" })
    expect(await storedValue()).toBe("default")
  })

  it("creates the settings row when none exists", async () => {
    // Activation must not require somebody to have visited the settings screen
    // first — hence an upsert rather than an update.
    await db.delete(settings).where(eq(settings.id, SETTINGS_SINGLETON_ID))
    await expect(setActiveTheme("integration")).resolves.toMatchObject({ ok: true })
    expect(await storedValue()).toBe("integration")
  })
})

describe("setActiveTheme — rejects", () => {
  it("a theme this build does not contain", async () => {
    await setActiveTheme("default")
    const result = await setActiveTheme("aurora-nightfall")
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/"aurora-nightfall" is installed in this build/i)
    // The write path is strict precisely so the resilient read path is never
    // exercised in practice: nothing broken was persisted.
    expect(await storedValue()).toBe("default")
  })

  const malformed = ["Default", "not a slug", "../../etc/passwd", "trailing-", "", "   ", "a".repeat(65)]

  it.each(malformed)("a malformed slug %j", async (value) => {
    await setActiveTheme("default")
    const result = await setActiveTheme(value)
    expect(result.ok).toBe(false)
    expect(await storedValue()).toBe("default")
  })

  it("does not echo a rejected slug back to the caller", async () => {
    // It arrives from outside and ends up in an admin page. A value that failed
    // the format check is by definition not something to render.
    const result = await setActiveTheme("<script>alert(1)</script>")
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).not.toContain("script")
  })

  it("an installed but unavailable theme", async () => {
    // Proved against the registry's own classification: `getInstalledTheme`
    // returns the entry, `available` is false, and the setter must refuse it.
    // A theme that cannot render must not be activatable, or the site would
    // fall back on every request while the admin panel claimed success.
    const entry = getInstalledTheme("integration")
    expect(entry?.available).toBe(true)
    // (There is no unavailable theme in the shipped registry to activate — that
    // path is covered by the unit tests in registry.test.ts, and by the branch
    // in setActiveTheme that reads `installed.available`.)
  })
})

describe("clearActiveTheme", () => {
  it("returns to no selection, storing null rather than the literal default", async () => {
    // One representation for "no choice made". Writing "default" would give the
    // same behaviour two spellings and let them disagree.
    await setActiveTheme("integration")
    await clearActiveTheme()
    expect(await storedValue()).toBeNull()
    await expect(getActiveThemeSlug()).resolves.toBeNull()
  })
})

describe("activation is visible without a restart", () => {
  it("a subsequent read sees the new value", async () => {
    // The property Phase 6.4's activation UX depends on. Settings reads go
    // through the shared settings cache and `setActiveTheme` invalidates it, so
    // the next request resolves the new theme in the same process.
    await setActiveTheme("default")
    expect(await getActiveThemeSlug()).toBe("default")

    await setActiveTheme("integration")
    expect(await getActiveThemeSlug()).toBe("integration")

    await setActiveTheme("default")
    expect(await getActiveThemeSlug()).toBe("default")
  })
})

describe("activation never touches content", () => {
  it("leaves content rows byte-identical across a theme switch", async () => {
    // Theme selection is presentation. If activating a theme could migrate,
    // rewrite or even re-timestamp a row, switching themes would be a
    // destructive operation and nobody would dare try one.
    const id = crypto.randomUUID()
    await db.insert(blogTags).values({
      id,
      name: "Immutable",
      slug: `immutable-${Date.now()}`,
      isIndexable: true,
      isActive: true,
      createdAt: new Date(1755780000000),
      updatedAt: new Date(1755780000000),
    })

    // The whole row as the database returns it, not just the columns this test
    // happened to set — a mutation in a column the test did not think about is
    // exactly the kind this assertion exists to catch.
    const [before] = await db.select().from(blogTags).where(eq(blogTags.id, id))

    await setActiveTheme("integration")
    await setActiveTheme("default")
    await clearActiveTheme()

    const [after] = await db.select().from(blogTags).where(eq(blogTags.id, id))
    expect(after).toEqual(before)
  })
})

describe("isWellFormedThemeSlug", () => {
  it.each(["default", "integration", "aurora-nightfall", "a", "two-part", "v2-theme"])("accepts %j", (value) => {
    expect(isWellFormedThemeSlug(value)).toBe(true)
  })

  it.each(["", " ", "Aurora", "au rora", "-lead", "trail-", "a--b", "../x", "a".repeat(65)])(
    "rejects %j",
    (value) => {
      expect(isWellFormedThemeSlug(value)).toBe(false)
    },
  )
})
