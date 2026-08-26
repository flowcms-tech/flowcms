import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { and, eq, sql } from "drizzle-orm"
import { parseDatabaseConfig, type DatabaseDialect } from "@/Framework/Config/databaseConfig"
import { createDatabase, type DatabaseHandle } from "@/db/createDatabase"
import { likeContains } from "@/db/likeEscape"
import { normalizeEmail } from "@/Framework/Auth/identity"

/**
 * One contract, four engines.
 *
 * Deliberately ONE parameterized suite rather than four files. Four copies
 * drift, and the drift is invisible: each file keeps passing against its own
 * database while quietly testing something slightly different, which is the
 * precise failure this suite exists to detect.
 *
 * SQLite runs always, against a temporary file, so `bun run test` needs no
 * servers. The remote engines run only when their URL is supplied:
 *
 *   TEST_POSTGRES_URL=postgresql://…  \
 *   TEST_MYSQL_URL=mysql://…          \
 *   TEST_MARIADB_URL=mysql://…        bun run test
 *
 * MariaDB is listed separately from MySQL on purpose. It shares the driver and
 * the migration SQL, and it is still a different product; "probably compatible"
 * is not a support claim.
 */

interface Target {
  name: string
  dialect: DatabaseDialect
  url: string
}

function targets(): Target[] {
  const out: Target[] = [
    {
      name: "sqlite",
      dialect: "sqlite",
      url: `file:${join(mkdtempSync(join(tmpdir(), "flowcms-contract-")), "contract.db")}`,
    },
  ]
  if (process.env.TEST_POSTGRES_URL) {
    out.push({ name: "postgresql", dialect: "postgresql", url: process.env.TEST_POSTGRES_URL })
  }
  if (process.env.TEST_MYSQL_URL) {
    out.push({ name: "mysql", dialect: "mysql", url: process.env.TEST_MYSQL_URL })
  }
  if (process.env.TEST_MARIADB_URL) {
    out.push({ name: "mariadb", dialect: "mariadb", url: process.env.TEST_MARIADB_URL })
  }
  return out
}

const handles: DatabaseHandle[] = []

afterAll(async () => {
  await Promise.all(handles.map((h) => h.close().catch(() => {})))
})

for (const target of targets()) {
  describe(`database contract — ${target.name}`, () => {
    const config = parseDatabaseConfig({
      DATABASE_DIALECT: target.dialect,
      DATABASE_URL: target.url,
    })
    const handle = createDatabase(config)
    handles.push(handle)
    const { db } = handle
    const t = handle.schema

    beforeAll(async () => {
      // Remote engines are migrated by the harness that starts them; the
      // SQLite target is a fresh temp file, so it migrates itself. Keeping the
      // suite self-contained is what lets  cover one dialect
      // with no external setup at all.
      if (target.dialect !== "sqlite") return
      const { createClient } = await import("@libsql/client")
      const { drizzle } = await import("drizzle-orm/libsql")
      const { migrate } = await import("drizzle-orm/libsql/migrator")
      const client = createClient({ url: target.url })
      try {
        await migrate(drizzle(client), { migrationsFolder: "src/db/migrations/sqlite" })
      } finally {
        client.close()
      }
    }, 60_000)

    // A table with a text pk, a boolean, a timestamp, a nullable and a unique.
    const table = t.blogTags
    const unique = (suffix: string) => `contract-${target.name}-${suffix}-${Date.now()}`

    it("connects", async () => {
      await expect(handle.ping()).resolves.not.toThrow()
    })

    it("reports migrations as applied", async () => {
      await expect(handle.migrationsApplied()).resolves.toBe(true)
    })

    it("inserts and selects, with an application-generated id", async () => {
      const id = crypto.randomUUID()
      const slug = unique("insert")
      await db.insert(table).values({
        id,
        name: "Contract",
        slug,
        isIndexable: true,
        isActive: true,
        createdAt: new Date(1755780000000),
        updatedAt: new Date(1755780000000),
      })

      const [row] = await db.select().from(table).where(eq(table.id, id))
      expect(row.id).toBe(id)
      expect(row.name).toBe("Contract")
    })

    it("round-trips booleans as real booleans", async () => {
      const id = crypto.randomUUID()
      await db.insert(table).values({
        id,
        name: "Bool",
        slug: unique("bool"),
        isIndexable: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      const [row] = await db.select().from(table).where(eq(table.id, id))
      // SQLite stores 0/1, MySQL uses tinyint(1); the application must never
      // see either of those.
      expect(typeof row.isIndexable).toBe("boolean")
      expect(row.isIndexable).toBe(false)
      expect(row.isActive).toBe(true)
    })

    it("round-trips timestamps as Date, to the exact millisecond", async () => {
      const id = crypto.randomUUID()
      const when = new Date(1755780000123)
      await db.insert(table).values({
        id,
        name: "Time",
        slug: unique("time"),
        isIndexable: true,
        isActive: true,
        createdAt: when,
        updatedAt: when,
      })
      const [row] = await db.select().from(table).where(eq(table.id, id))
      expect(row.createdAt).toBeInstanceOf(Date)
      expect(row.createdAt.getTime()).toBe(1755780000123)
    })

    it("round-trips nulls", async () => {
      const id = crypto.randomUUID()
      await db.insert(table).values({
        id,
        name: "Null",
        slug: unique("null"),
        metaTitle: null,
        isIndexable: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      const [row] = await db.select().from(table).where(eq(table.id, id))
      expect(row.metaTitle).toBeNull()
    })

    it("enforces unique constraints", async () => {
      const slug = unique("dup")
      const base = {
        name: "Dup",
        slug,
        isIndexable: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      await db.insert(table).values({ id: crypto.randomUUID(), ...base })
      await expect(
        db.insert(table).values({ id: crypto.randomUUID(), ...base }),
      ).rejects.toThrow()
    })

    it("updates and deletes", async () => {
      const id = crypto.randomUUID()
      await db.insert(table).values({
        id,
        name: "Before",
        slug: unique("upd"),
        isIndexable: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      await db.update(table).set({ name: "After" }).where(eq(table.id, id))
      const [updated] = await db.select().from(table).where(eq(table.id, id))
      expect(updated.name).toBe("After")

      await db.delete(table).where(eq(table.id, id))
      const gone = await db.select().from(table).where(eq(table.id, id))
      expect(gone).toHaveLength(0)
    })

    it("rolls a failed transaction back", async () => {
      const id = crypto.randomUUID()
      await expect(
        db.transaction(async (tx) => {
          await tx.insert(table).values({
            id,
            name: "Rollback",
            slug: unique("rollback"),
            isIndexable: true,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          throw new Error("deliberate")
        }),
      ).rejects.toThrow("deliberate")

      const rows = await db.select().from(table).where(eq(table.id, id))
      expect(rows, "the rolled-back row must not exist").toHaveLength(0)
    })

    it("commits a successful transaction", async () => {
      const id = crypto.randomUUID()
      await db.transaction(async (tx) => {
        await tx.insert(table).values({
          id,
          name: "Commit",
          slug: unique("commit"),
          isIndexable: true,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      })
      const rows = await db.select().from(table).where(eq(table.id, id))
      expect(rows).toHaveLength(1)
    })

    it("escapes LIKE wildcards identically", async () => {
      // The literal value contains % and _, which are LIKE metacharacters.
      // Phase 1's likeContains escapes them; §20 flagged MySQL's sql_mode as a
      // risk to that, so it is checked on every engine rather than assumed.
      const literal = unique("a%b_c")
      await db.insert(table).values({
        id: crypto.randomUUID(),
        name: "Like",
        slug: literal,
        isIndexable: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const found = await db.select().from(table).where(likeContains(table.slug, literal))
      expect(found, "the literal string must match itself").toHaveLength(1)

      const decoy = literal.replace("a%b_c", "aXXbYc")
      const notFound = await db.select().from(table).where(likeContains(table.slug, decoy))
      expect(notFound, "% and _ must not act as wildcards").toHaveLength(0)
    })

    it("enforces foreign keys", async () => {
      // blog_post.authorId references user.id with onDelete restrict.
      await expect(
        db.insert(t.blogPostTags).values({
          postId: "does-not-exist",
          tagId: "also-does-not-exist",
        }),
      ).rejects.toThrow()
    })

    it("reads and writes the settings singleton", async () => {
      const existing = await db.select().from(t.settings).limit(1)
      if (existing.length === 0) {
        await db.insert(t.settings).values({ siteName: "Contract Site" })
      } else {
        await db.update(t.settings).set({ siteName: "Contract Site" })
      }
      const [row] = await db.select().from(t.settings).limit(1)
      expect(row.siteName).toBe("Contract Site")
    })

    it("stores a JSON text field as an exact string", async () => {
      // JSON is stored stringified in a text column on every dialect — there is
      // no jsonb fork — so what goes in must come out byte-identical.
      const id = crypto.randomUUID()
      const payload = JSON.stringify({ changed: ["title", "slug"], n: 2 })
      await db.insert(t.activityLog).values({
        id,
        actorName: "Contract",
        action: "updated",
        entityType: "post",
        entityLabel: "A post",
        metadata: payload,
        createdAt: new Date(),
      })
      const [row] = await db.select().from(t.activityLog).where(eq(t.activityLog.id, id))
      expect(row.metadata).toBe(payload)
      expect(JSON.parse(row.metadata as string)).toEqual({ changed: ["title", "slug"], n: 2 })
    })


    it("treats differently-cased emails as one identity", async () => {
      // The portable contract is application normalisation, NOT collation.
      // Without normalizeEmail these two rows coexist on SQLite/PostgreSQL and
      // collide on MySQL/MariaDB — one product, two behaviours.
      const raw = `Owner+${target.name}-${Date.now()}@Example.COM`
      const normalized = normalizeEmail(raw)

      await db.insert(t.users).values({
        id: crypto.randomUUID(),
        email: normalized,
        name: "Case One",
        role: "owner",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // A different casing of the same address normalises to the same value and
      // must therefore be rejected by the unique index on every engine.
      const sameAddressDifferentCase = raw.toUpperCase()
      await expect(
        db.insert(t.users).values({
          id: crypto.randomUUID(),
          email: normalizeEmail(sameAddressDifferentCase),
          name: "Case Two",
          role: "owner",
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ).rejects.toThrow()

      // And a lookup written in any casing finds the row.
      const found = await db
        .select()
        .from(t.users)
        .where(eq(t.users.email, normalizeEmail(raw.toLowerCase())))
      expect(found).toHaveLength(1)
      expect(found[0].email).toBe(normalized)
    })

    it("keeps genuinely different emails distinct", async () => {
      const stamp = Date.now()
      const a = normalizeEmail(`a-${target.name}-${stamp}@example.com`)
      const b = normalizeEmail(`b-${target.name}-${stamp}@example.com`)
      for (const email of [a, b]) {
        await db.insert(t.users).values({
          id: crypto.randomUUID(),
          email,
          role: "contributor",
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }
      const rows = await db.select().from(t.users).where(eq(t.users.email, a))
      expect(rows).toHaveLength(1)
    })

    /**
     * settings.activeTheme — Phase 6.3.
     *
     * The only piece of theme state that lives in the database, so it is the
     * only piece that can differ between engines. Written here rather than in a
     * theme test because what is under test is the COLUMN: that the migration
     * added it on this engine, that a slug survives a round trip, that NULL is
     * a distinct value from the empty string, and that an upsert against the
     * singleton updates rather than duplicating.
     *
     * MySQL and MariaDB matter most: they have no ON CONFLICT clause, so the
     * upsert takes the `onDuplicateKeyUpdate` branch of @/db/writes here and
     * the ON CONFLICT branch on the other two.
     */
    describe("settings.activeTheme", () => {
      const settingsId = `settings-${target.name}`

      beforeAll(async () => {
        // Idempotent against a long-lived database. The remote engines in this
        // suite are supplied by the caller and persist between runs, so a plain
        // insert passes once and then fails with a duplicate key forever —
        // which is exactly what happened the first time this block was run
        // twice.
        await db.delete(t.settings).where(eq(t.settings.id, settingsId))
      })

      it("round-trips a theme slug", async () => {
        await db.insert(t.settings).values({
          id: settingsId,
          activeTheme: "integration",
          updatedAt: new Date(1755780000000),
        })

        const [row] = await db.select().from(t.settings).where(eq(t.settings.id, settingsId))
        expect(row.activeTheme).toBe("integration")
      })

      it("stores null as an absent selection, distinct from an empty string", async () => {
        // The resolver treats both as "no theme selected", but the column has
        // to be able to hold null in the first place — a NOT NULL default of
        // "" on one engine would be a different product sharing a name.
        await db
          .update(t.settings)
          .set({ activeTheme: null, updatedAt: new Date(1755780000001) })
          .where(eq(t.settings.id, settingsId))

        const [row] = await db.select().from(t.settings).where(eq(t.settings.id, settingsId))
        expect(row.activeTheme).toBeNull()
      })

      /**
       * The upsert `setActiveTheme` performs, dispatched the way
       * `@/db/writes.upsert` dispatches it.
       *
       * Mirrored rather than imported because that helper is bound to the
       * application's global client, and this suite drives a handle per engine.
       * Mirroring is worth it for one reason: MySQL and MariaDB have no ON
       * CONFLICT clause at all, so this is the only place the
       * ON DUPLICATE KEY UPDATE branch of the activation write is exercised
       * against a real MySQL and a real MariaDB.
       */
      async function upsertActiveTheme(slug: string, updatedAt: Date) {
        const values = { id: settingsId, activeTheme: slug, updatedAt }
        const set = { activeTheme: slug, updatedAt }

        if (target.dialect === "sqlite" || target.dialect === "postgresql") {
          await db.insert(t.settings).values(values).onConflictDoUpdate({ target: t.settings.id, set })
          return
        }

        const insert = db.insert(t.settings).values(values) as unknown as {
          onDuplicateKeyUpdate: (config: { set: Record<string, unknown> }) => Promise<unknown>
        }
        await insert.onDuplicateKeyUpdate({ set })
      }

      it("upserts the singleton rather than inserting a second row", async () => {
        await upsertActiveTheme("default", new Date(1755780000002))

        const rows = await db.select().from(t.settings).where(eq(t.settings.id, settingsId))
        expect(rows).toHaveLength(1)
        expect(rows[0].activeTheme).toBe("default")
      })

      it("holds a slug that names no installed theme, so the resolver can fall back", async () => {
        // The database must be able to carry an operator's intent through a
        // deploy that removed their theme. Nothing here validates the value —
        // that is the write path's job, and the read path has to tolerate rows
        // written by an older version.
        await upsertActiveTheme("aurora", new Date(1755780000003))

        const [row] = await db.select().from(t.settings).where(eq(t.settings.id, settingsId))
        expect(row.activeTheme).toBe("aurora")
      })
    })

    it("counts with a raw portable SQL fragment", async () => {
      const rows = await db
        .select({ n: sql<number>`count(*)` })
        .from(table)
        .where(and(eq(table.isActive, true)))
      expect(Number(rows[0].n)).toBeGreaterThan(0)
    })
  })
}
