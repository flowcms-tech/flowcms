// MUST be first: it sets DATABASE_URL before `@/db/client` reads it.
import { DB_DIALECT, DB_URL } from "./setupEnv"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db/client"
import { affectedRowCount } from "@/db/writes"
// Runtime facade — see the note in setupBoundary.test.ts.
import { settings, users } from "@/db/tables"
import { SETTINGS_SINGLETON_ID } from "@/db/schema/settings"
import { completeSetup } from "@/Framework/Setup/completeSetup"
import { getSetupStatus } from "@/Framework/Setup/setupState"
import { invalidateSettingsCache } from "@/Framework/Settings/SettingsService"

/**
 * Two things that cannot be proved by a happy path, on a real database.
 *
 * 1. THE CLAIM PRIMITIVE. `UPDATE … WHERE setupCompletedAt IS NULL` must report
 *    one affected row the first time and zero the second. Everything about the
 *    concurrency guarantee rests on that, and `affectedRowCount` normalising
 *    three driver shapes is exactly the kind of thing that works on the engine
 *    you developed against and silently returns `undefined` on the other three.
 *
 * 2. ROLLBACK. A failure between the claim and the commit must leave NOTHING —
 *    no owner, no site identity, no marker — because a half-initialized
 *    installation is unrecoverable through the product: setup would be closed
 *    with nobody able to log in.
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
})

beforeEach(async () => {
  await db.delete(users)
  await db.delete(settings).where(eq(settings.id, SETTINGS_SINGLETON_ID))
  await invalidateSettingsCache()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("the conditional claim, against this engine", () => {
  it("matches one row the first time and zero the second", async () => {
    await db.insert(settings).values({
      id: SETTINGS_SINGLETON_ID,
      updatedAt: new Date(1_700_000_000_000),
    })

    const first = await db
      .update(settings)
      .set({ setupCompletedAt: new Date(1_700_000_001_000) })
      .where(and(eq(settings.id, SETTINGS_SINGLETON_ID), isNull(settings.setupCompletedAt)))

    const second = await db
      .update(settings)
      .set({ setupCompletedAt: new Date(1_700_000_002_000) })
      .where(and(eq(settings.id, SETTINGS_SINGLETON_ID), isNull(settings.setupCompletedAt)))

    // If `affectedRowCount` cannot read this driver's result shape it returns
    // 0, and the FIRST assertion is what catches that — a claim that always
    // reports "I lost" is safe but breaks setup, and it breaks it here rather
    // than in production.
    expect(affectedRowCount(first)).toBe(1)
    expect(affectedRowCount(second)).toBe(0)

    // And the losing update genuinely did not overwrite the winner's value.
    const [row] = await db.select().from(settings).where(eq(settings.id, SETTINGS_SINGLETON_ID))
    expect(Number(row.setupCompletedAt)).toBe(1_700_000_001_000)
  })
})

/**
 * Inject a failure between the claim and the commit.
 *
 * `db.transaction` is wrapped so the callback receives a transaction whose
 * SECOND write throws. On a fresh install the writes are, in order, the
 * settings claim and the owner insert — so this fails at precisely the point
 * §54 asks about: after validation, after the claim, before commit.
 *
 * Nothing test-only is added to the production module. The real transaction,
 * the real driver and the real rollback all run.
 */
function failAfterTheClaim(): { writes: () => number } {
  let attempted = 0
  const realTransaction = db.transaction.bind(db)
  vi.spyOn(db, "transaction").mockImplementation((async (callback: (tx: unknown) => unknown) =>
    realTransaction(async (tx) => {
      const proxied = new Proxy(tx as object, {
        get(target, property, receiver) {
          if (property === "insert" || property === "update") {
            return (...args: unknown[]) => {
              attempted += 1
              if (attempted === 2) throw new Error("injected: storage went away mid-setup")
              return (Reflect.get(target, property, receiver) as (...a: unknown[]) => unknown).apply(
                target,
                args,
              )
            }
          }
          const value = Reflect.get(target, property, receiver)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
      return callback(proxied)
    })) as unknown as typeof db.transaction)
  return { writes: () => attempted }
}

describe("a failure between the claim and the commit", () => {
  it("rolls back completely and leaves setup available", async () => {
    const injected = failAfterTheClaim()

    await expect(
      completeSetup({
        siteName: "Half Written",
        tagline: "Should not survive",
        ownerEmail: "owner@example.com",
        ownerPassword: "correct-horse-battery-staple",
        ownerName: "Ada Lovelace",
      }),
    ).rejects.toThrow(/injected/)

    // The claim ran and THEN the failure hit — otherwise this test would pass
    // by failing before the settings row was ever written, proving nothing
    // about rollback.
    expect(injected.writes()).toBe(2)

    vi.restoreAllMocks()
    await invalidateSettingsCache()

    // No owner.
    expect(await db.select().from(users)).toHaveLength(0)

    // No settings row, so no partial site identity and no marker. The three
    // failure shapes §26 names — owner without marker, marker without owner,
    // settings without owner — are all absent because the transaction is whole.
    const rows = await db.select().from(settings).where(eq(settings.id, SETTINGS_SINGLETON_ID))
    expect(rows).toHaveLength(0)

    // And setup is still open, which is the point: a failed attempt must leave
    // the operator able to try again.
    expect((await getSetupStatus()).state).toBe("incomplete")
  })

  it("leaves a retry able to succeed", async () => {
    failAfterTheClaim()
    await expect(
      completeSetup({
        siteName: "Half Written",
        ownerEmail: "owner@example.com",
        ownerPassword: "correct-horse-battery-staple",
      }),
    ).rejects.toThrow(/injected/)

    vi.restoreAllMocks()
    await invalidateSettingsCache()

    const retry = await completeSetup({
      siteName: "Written Properly",
      ownerEmail: "owner@example.com",
      ownerPassword: "correct-horse-battery-staple",
    })

    expect(retry.ok).toBe(true)
    expect(await db.select().from(users)).toHaveLength(1)
    const [row] = await db.select().from(settings).where(eq(settings.id, SETTINGS_SINGLETON_ID))
    expect(row.siteName).toBe("Written Properly")
  })
})
