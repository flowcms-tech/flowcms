// MUST be first: it sets DATABASE_URL before `@/db/client` reads it.
import { DB_DIALECT, DB_URL } from "../themes/activationEnv"
import { beforeAll, describe, expect, it } from "vitest"
import { desc, eq } from "drizzle-orm"
import { db } from "@/db/client"
import { activityLog } from "@/db/schema/activityLog"
import { settings, SETTINGS_SINGLETON_ID } from "@/db/schema/settings"
import { users } from "@/db/schema/users"
import { recordActivity } from "@/db/activityLog"
import {
  clearActiveTheme,
  getActiveThemeSlug,
  setActiveTheme,
} from "@/Framework/Settings/themeSelection"
import { DEFAULT_THEME_SLUG, isNoOpActivation } from "@/Themes/constants"

/**
 * Everything the activation endpoint does to the database, on whichever engine
 * this run is pointed at.
 *
 * The route itself is a transport shell — authenticate, authorise, parse, call
 * these functions, write an activity entry. Driving the functions directly
 * covers the part that can differ between PostgreSQL, MySQL, MariaDB and
 * SQLite, without standing up an HTTP server four times.
 *
 * SQLite by default. The other three run when pointed at a real engine:
 *
 *   TEST_ACTIVATION_DIALECT=mysql TEST_ACTIVATION_URL=mysql://… \
 *     npx vitest run tests/appearance/activationBoundary.test.ts
 *
 * MariaDB is run separately from MySQL. It shares a driver and the migration
 * SQL and is still a different product; Phase 5 found a bug that only MariaDB
 * caught, which is why "probably compatible" is not a support claim here.
 */

const ACTOR = {
  id: "00000000-0000-4000-8000-00000000a114",
  name: "Activation Test",
  email: "activation@example.test",
}

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

  // Idempotent: the remote engines in this suite are supplied by the caller and
  // persist between runs.
  await db.delete(activityLog).where(eq(activityLog.entityType, "theme"))
  await db.delete(settings).where(eq(settings.id, SETTINGS_SINGLETON_ID))
  await db.delete(users).where(eq(users.id, ACTOR.id))

  // The activity log references a user; a real actor makes the foreign key
  // meaningful on the engines that enforce it.
  await db.insert(users).values({
    id: ACTOR.id,
    name: ACTOR.name,
    email: ACTOR.email,
    role: "admin",
    isActive: true,
    createdAt: new Date(1755780000000),
    updatedAt: new Date(1755780000000),
  })
}, 120_000)

/** What the route does on a successful activation, in the same order. */
async function activate(slug: string) {
  const previousSlug = await getActiveThemeSlug()

  if (isNoOpActivation(slug, previousSlug)) return { changed: false as const, previousSlug }

  if (slug === DEFAULT_THEME_SLUG) {
    await clearActiveTheme()
  } else {
    const result = await setActiveTheme(slug)
    if (!result.ok) return { changed: false as const, previousSlug, error: result.error }
  }

  await recordActivity({
    actor: ACTOR,
    action: "activated",
    entityType: "theme",
    entityId: slug,
    entityLabel: slug,
    summary: `Switched the public site theme from "${previousSlug ?? DEFAULT_THEME_SLUG}" to "${slug}"`,
    metadata: { from: previousSlug, to: slug === DEFAULT_THEME_SLUG ? null : slug },
  })

  return { changed: true as const, previousSlug }
}

async function themeEntries() {
  return db
    .select()
    .from(activityLog)
    .where(eq(activityLog.entityType, "theme"))
    .orderBy(desc(activityLog.createdAt))
}

describe(`activation boundary — ${DB_DIALECT}`, () => {
  it("starts with no selection and no theme entries", async () => {
    await expect(getActiveThemeSlug()).resolves.toBeNull()
    expect(await themeEntries()).toHaveLength(0)
  })

  it("activates a registered theme and records one entry", async () => {
    const result = await activate("integration")
    expect(result.changed).toBe(true)
    await expect(getActiveThemeSlug()).resolves.toBe("integration")

    const entries = await themeEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      action: "activated",
      entityType: "theme",
      entityId: "integration",
      actorName: ACTOR.name,
    })
    // Names both ends, because "what was it before" is the question asked of
    // an entry like this.
    expect(entries[0].summary).toContain("integration")
    expect(entries[0].actorId).toBe(ACTOR.id)
  })

  it("stores the actor and the transition in metadata, portably", async () => {
    // `metadata` is a JSON string column on every engine; JSON *types* differ
    // between PostgreSQL and MySQL, which is why this is text.
    const [entry] = await themeEntries()
    expect(JSON.parse(entry.metadata!)).toEqual({ from: null, to: "integration" })
  })

  it("writes nothing and logs nothing when re-activating the same theme", async () => {
    const before = await themeEntries()
    const result = await activate("integration")

    expect(result.changed).toBe(false)
    // A second "activated" entry for a change that did not happen makes the
    // audit trail less trustworthy, not more.
    expect(await themeEntries()).toHaveLength(before.length)
    await expect(getActiveThemeSlug()).resolves.toBe("integration")
  })

  it("normalises the default theme to NULL rather than the literal string", async () => {
    const result = await activate(DEFAULT_THEME_SLUG)
    expect(result.changed).toBe(true)

    const [row] = await db.select().from(settings).where(eq(settings.id, SETTINGS_SINGLETON_ID))
    expect(row.activeTheme).toBeNull()
    await expect(getActiveThemeSlug()).resolves.toBeNull()
  })

  it("records the return to default too", async () => {
    const entries = await themeEntries()
    expect(entries).toHaveLength(2)
    expect(entries.some((e) => e.entityId === DEFAULT_THEME_SLUG)).toBe(true)
  })

  it("treats activating the default again as a no-op", async () => {
    const before = await themeEntries()
    expect((await activate(DEFAULT_THEME_SLUG)).changed).toBe(false)
    expect(await themeEntries()).toHaveLength(before.length)
  })

  it("refuses an uninstalled theme, writing nothing and logging nothing", async () => {
    const before = await themeEntries()
    const result = await activate("aurora-nightfall")

    expect(result.changed).toBe(false)
    expect(result.error).toMatch(/is installed in this build/i)
    await expect(getActiveThemeSlug()).resolves.toBeNull()
    expect(await themeEntries()).toHaveLength(before.length)
  })

  it("refuses a malformed slug, writing nothing and logging nothing", async () => {
    const before = await themeEntries()
    const result = await activate("NOT A SLUG")

    expect(result.changed).toBe(false)
    await expect(getActiveThemeSlug()).resolves.toBeNull()
    expect(await themeEntries()).toHaveLength(before.length)
  })

  it("makes the new value readable immediately, with no restart", async () => {
    // The property the activation UX depends on: `setActiveTheme` invalidates
    // the settings cache, so the very next read resolves the new theme in the
    // same process.
    await activate("integration")
    await expect(getActiveThemeSlug()).resolves.toBe("integration")

    await activate(DEFAULT_THEME_SLUG)
    await expect(getActiveThemeSlug()).resolves.toBeNull()
  })
})
