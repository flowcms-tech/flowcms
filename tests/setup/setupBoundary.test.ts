// MUST be first: it sets DATABASE_URL before `@/db/client` reads it.
import { DB_DIALECT, DB_URL } from "./setupEnv"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import bcrypt from "bcryptjs"
import { db } from "@/db/client"
// Tables from the RUNTIME facade, not from @/db/schema. This suite runs
// against all four engines, and a query built from the canonical SQLite column
// objects carries SQLite encoders/decoders to whichever engine answered — the
// Phase 5.2 defect. It bit this very file: postgres.js returns bigint as a
// string, SQLite's timestamp mapper turned that into an Invalid Date, and an
// assertion comparing NaN to NaN passed vacuously.
// SETTINGS_SINGLETON_ID stays canonical: it is a dialect-free constant, and the
// facade deliberately does not re-export it.
import { settings, users, activityLog } from "@/db/tables"
import { SETTINGS_SINGLETON_ID } from "@/db/schema/settings"
import { completeSetup, MIN_OWNER_PASSWORD_LENGTH } from "@/Framework/Setup/completeSetup"
import { getSetupStatus, isSetupClosed } from "@/Framework/Setup/setupState"
import { invalidateSettingsCache } from "@/Framework/Settings/SettingsService"

/**
 * Everything first-run setup does to the database, on whichever engine this run
 * is pointed at.
 *
 * The route is a transport shell — rate limit, verify the token, check the
 * origin, parse, call `completeSetup`, log. Driving the domain directly covers
 * the part that can differ between SQLite, PostgreSQL, MySQL and MariaDB
 * without standing up an HTTP server four times.
 *
 *   TEST_SETUP_DIALECT=mysql TEST_SETUP_URL=mysql://… \
 *     npx vitest run tests/setup/setupBoundary.test.ts
 */

const GOOD_PASSWORD = "correct-horse-battery-staple"

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
})

/**
 * Reset to "never initialized" before each case.
 *
 * Deletes only what this suite owns. A shared test database on a remote engine
 * holds other suites' rows, and a blanket `db.delete(users)` fails on
 * MySQL/MariaDB against an ON DELETE RESTRICT foreign key from something this
 * suite never created.
 */
beforeEach(async () => {
  await db.delete(activityLog).where(eq(activityLog.entityType, "settings"))
  await db.delete(users)
  await db.delete(settings).where(eq(settings.id, SETTINGS_SINGLETON_ID))
  await invalidateSettingsCache()
})

async function markerRow() {
  const [row] = await db.select().from(settings).where(eq(settings.id, SETTINGS_SINGLETON_ID))
  return row
}

const INPUT = {
  siteName: "Acme Docs",
  tagline: "Everything we know, written down",
  ownerEmail: "  Owner@Example.COM ",
  ownerPassword: GOOD_PASSWORD,
  ownerName: "Ada Lovelace",
}

describe("a fresh installation", () => {
  it("reports setup as incomplete before anything happens", async () => {
    expect((await getSetupStatus()).state).toBe("incomplete")
    expect(await isSetupClosed()).toBe(false)
  })

  it("has no settings row at all — the marker is absent, not false", async () => {
    // A fresh install must render its public site before anyone configures
    // anything, so "no row" is a state the product genuinely has.
    expect(await markerRow()).toBeUndefined()
  })

  it("completes, creating exactly one owner and the marker together", async () => {
    const result = await completeSetup(INPUT)
    expect(result.ok).toBe(true)

    const all = await db.select().from(users)
    expect(all).toHaveLength(1)
    expect(all[0].role).toBe("owner")
    expect(all[0].isActive).toBe(true)

    const row = await markerRow()
    expect(row?.setupCompletedAt).toBeTruthy()
    expect(row?.siteName).toBe("Acme Docs")
    expect(row?.tagline).toBe("Everything we know, written down")
  })

  it("normalizes the owner email exactly as the rest of the product does", async () => {
    await completeSetup(INPUT)
    const [owner] = await db.select().from(users)
    expect(owner.email).toBe("owner@example.com")
  })

  it("stores a bcrypt hash that verifies, and never the password", async () => {
    await completeSetup(INPUT)
    const [owner] = await db.select().from(users)

    expect(owner.passwordHash).toBeTruthy()
    expect(owner.passwordHash).not.toContain(GOOD_PASSWORD)
    expect(await bcrypt.compare(GOOD_PASSWORD, owner.passwordHash!)).toBe(true)
    // Cost 12, the production bootstrap's factor.
    expect(owner.passwordHash!.startsWith("$2a$12$") || owner.passwordHash!.startsWith("$2b$12$")).toBe(true)

    // The raw password must not have leaked into any other column of the row.
    expect(JSON.stringify(owner)).not.toContain(GOOD_PASSWORD)
  })

  it("closes setup permanently once complete", async () => {
    await completeSetup(INPUT)
    const status = await getSetupStatus()
    expect(status.state).toBe("complete")
    expect(await isSetupClosed()).toBe(true)
  })

  it("leaves activeTheme null — setup does not choose a theme", async () => {
    await completeSetup(INPUT)
    // Null already means "the default theme". Writing the literal because setup
    // ran would give one behaviour two representations.
    expect((await markerRow())?.activeTheme).toBeNull()
  })

  it("leaves the tagline null when it is omitted", async () => {
    await completeSetup({ ...INPUT, tagline: undefined })
    expect((await markerRow())?.tagline).toBeNull()
  })
})

describe("input the domain refuses", () => {
  it.each([
    ["a missing site name", { siteName: "   " }, "Site name is required"],
    ["a missing email", { ownerEmail: "" }, "Email is required"],
    ["a malformed email", { ownerEmail: "not-an-email" }, "Invalid email"],
    [
      "a short password",
      { ownerPassword: "short" },
      `Password must be at least ${MIN_OWNER_PASSWORD_LENGTH} characters`,
    ],
  ])("refuses %s", async (_label, override, message) => {
    const result = await completeSetup({ ...INPUT, ...override })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("invalid")
    expect(result).toHaveProperty("messages")
    expect((result as { messages: string[] }).messages).toContain(message)
  })

  it("writes nothing when validation fails", async () => {
    await completeSetup({ ...INPUT, ownerPassword: "short" })
    expect(await db.select().from(users)).toHaveLength(0)
    expect(await markerRow()).toBeUndefined()
    expect((await getSetupStatus()).state).toBe("incomplete")
  })

  it("never puts the submitted password in a validation message", async () => {
    const result = await completeSetup({ ...INPUT, ownerPassword: "hunter2" })
    expect(JSON.stringify(result)).not.toContain("hunter2")
  })
})

describe("completion is one-shot", () => {
  it("refuses a second identical attempt", async () => {
    expect((await completeSetup(INPUT)).ok).toBe(true)

    const second = await completeSetup(INPUT)
    expect(second.ok).toBe(false)
    expect((second as { reason: string }).reason).toBe("already_completed")
  })

  it("refuses a second attempt with a DIFFERENT owner email", async () => {
    // The interesting case: `user.email`'s unique index cannot stop this,
    // because the emails differ. The singleton marker has to.
    await completeSetup(INPUT)

    const second = await completeSetup({ ...INPUT, ownerEmail: "someone-else@example.com" })
    expect(second.ok).toBe(false)
    expect(await db.select().from(users)).toHaveLength(1)
  })

  it("does not rewrite site identity on a repeat attempt", async () => {
    await completeSetup(INPUT)

    await completeSetup({ ...INPUT, siteName: "Hijacked", tagline: "Also hijacked" })

    const after = await markerRow()
    expect(after?.siteName).toBe("Acme Docs")
    expect(after?.tagline).toBe("Everything we know, written down")
  })

  it("does not rewrite the completion timestamp on a repeat attempt", async () => {
    await completeSetup(INPUT, new Date(1_700_000_000_000))
    const first = (await markerRow())?.setupCompletedAt

    await completeSetup(INPUT, new Date(1_900_000_000_000))

    expect(Number((await markerRow())?.setupCompletedAt)).toBe(Number(first))
  })
})

describe("setup does not reopen", () => {
  it("stays closed after every user is deleted", async () => {
    await completeSetup(INPUT)
    expect(await db.select().from(users)).toHaveLength(1)

    // The privileged, test-only operation that models the real accident:
    // someone clears the user table.
    await db.delete(users)
    await invalidateSettingsCache()

    expect(await db.select().from(users)).toHaveLength(0)
    expect((await getSetupStatus()).state).toBe("complete")
    expect(await isSetupClosed()).toBe(true)
  })

  it("refuses a new completion attempt after every user is deleted", async () => {
    await completeSetup(INPUT)
    await db.delete(users)
    await invalidateSettingsCache()

    const attempt = await completeSetup({ ...INPUT, ownerEmail: "attacker@example.com" })
    expect(attempt.ok).toBe(false)
    expect(await db.select().from(users)).toHaveLength(0)
  })
})

describe("an installation that already has a user", () => {
  it("refuses completion even with the marker absent", async () => {
    // The backup-restore case: a database from before the marker existed, or a
    // CLI bootstrap on an older build. "Create the FIRST owner" is meaningless
    // here, and letting it through would mint a second owner beside the real
    // one.
    await db.insert(users).values({
      id: crypto.randomUUID(),
      name: "Existing Owner",
      email: "existing@example.com",
      passwordHash: await bcrypt.hash("something-long-enough", 4),
      isActive: true,
      role: "owner",
      createdAt: new Date(1_700_000_000_000),
      updatedAt: new Date(1_700_000_000_000),
    })

    const result = await completeSetup(INPUT)
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toBe("already_completed")
    expect(await db.select().from(users)).toHaveLength(1)
  })
})

describe("a settings row that exists with no marker", () => {
  it("is claimed by the conditional update rather than inserted", async () => {
    // An install whose settings row was created by something else — the
    // conditional-UPDATE branch of the claim, which is the branch the
    // affected-row count decides.
    await db.insert(settings).values({
      id: SETTINGS_SINGLETON_ID,
      siteName: "Placeholder",
      updatedAt: new Date(1_700_000_000_000),
    })
    await invalidateSettingsCache()

    expect((await getSetupStatus()).state).toBe("incomplete")

    const result = await completeSetup(INPUT)
    expect(result.ok).toBe(true)
    const row = await markerRow()
    expect(row?.setupCompletedAt).toBeTruthy()
    expect(row?.siteName).toBe("Acme Docs")
    expect(await db.select().from(users)).toHaveLength(1)
  })
})

describe("concurrent completion", () => {
  it("creates exactly one owner from five simultaneous attempts with five different emails", async () => {
    // THE MANDATORY CASE. Different emails, so the unique index on user.email
    // cannot be what saves this. Only the singleton claim can.
    const attempts = Array.from({ length: 5 }, (_, i) =>
      completeSetup({
        ...INPUT,
        siteName: `Site ${i}`,
        ownerEmail: `owner-${i}@example.com`,
      }),
    )

    const results = await Promise.all(attempts)

    const winners = results.filter((r) => r.ok)
    const losers = results.filter((r) => !r.ok)

    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(4)
    for (const loser of losers) {
      expect((loser as { reason: string }).reason).toBe("already_completed")
    }

    const owners = await db.select().from(users)
    expect(owners).toHaveLength(1)
    // The site identity that landed belongs to the attempt that won, not to a
    // mixture of them.
    const row = await markerRow()
    const winnerIndex = results.findIndex((r) => r.ok)
    expect(row?.siteName).toBe(`Site ${winnerIndex}`)
    expect(owners[0].email).toBe(`owner-${winnerIndex}@example.com`)
  })

  it("creates exactly one owner when a settings row already exists", async () => {
    // Same race, but through the conditional-UPDATE branch instead of the
    // INSERT branch, so the affected-row count is what decides the winner.
    await db.insert(settings).values({
      id: SETTINGS_SINGLETON_ID,
      siteName: "Placeholder",
      updatedAt: new Date(1_700_000_000_000),
    })
    await invalidateSettingsCache()

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        completeSetup({ ...INPUT, ownerEmail: `racer-${i}@example.com` }),
      ),
    )

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(await db.select().from(users)).toHaveLength(1)
  })
})

describe("site identity is data, not markup", () => {
  it("stores a hostile site name verbatim, to be escaped at render", async () => {
    const hostile = '<script>alert("xss")</script>'
    await completeSetup({ ...INPUT, siteName: hostile, tagline: '"><img src=x onerror=1>' })

    const row = await markerRow()
    // Stored exactly as typed. React escapes it at render, which is why the
    // right thing to do here is nothing — silently rewriting an operator's
    // site name would be a worse surprise than an escaped angle bracket.
    expect(row?.siteName).toBe(hostile)
    expect(row?.tagline).toBe('"><img src=x onerror=1>')
  })
})
