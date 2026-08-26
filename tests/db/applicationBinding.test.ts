// MUST be first: it sets DATABASE_URL before `@/db/client` reads it.
import { BINDING_DIALECT, BINDING_URL } from "./bindingEnv"
import { beforeAll, describe, expect, it } from "vitest"
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm"
import { getTableConfig as pgConfig } from "drizzle-orm/pg-core"
import { getTableConfig as mysqlConfig } from "drizzle-orm/mysql-core"
import { getTableConfig as sqliteConfig } from "drizzle-orm/sqlite-core"
import { db, handle } from "@/db/client"
// THE POINT OF THIS FILE: tables come from the runtime facade, which is exactly
// where application code gets them. Using `handle.schema` here would test a
// path the application does not take — the gap that let the defect ship.
import { blogCategories, blogPosts, customPages, menuItems, menus, users } from "@/db/tables"
import { insertReturning, updateReturning, deleteReturning, upsert } from "@/db/writes"
import { settings } from "@/db/tables"
import { SETTINGS_SINGLETON_ID } from "@/db/schema/settings"

/**
 * THE APPLICATION-BINDING CONTRACT.
 *
 * `tests/db/contract.test.ts` proves the ENGINE behaves. This proves the
 * APPLICATION's own query construction behaves — the two are different claims,
 * and only the first was being made.
 *
 * The defect that made this necessary: Drizzle takes a parameter's encoder from
 * the column object a query was built with, not from the executing database. A
 * boolean written through a canonical SQLite table object encodes as `1`, and
 * PostgreSQL stores `1` in a boolean column as **false**. The engine contract
 * missed it because it used the derived tables directly; the application used
 * the canonical ones.
 *
 * SQLite by default. The other three run when pointed at a real engine:
 *
 *   TEST_BINDING_DIALECT=postgresql TEST_BINDING_URL=postgresql://… \
 *     npx vitest run tests/db/applicationBinding.test.ts
 *
 * MariaDB is run separately from MySQL: same driver, different product.
 */

const ACTOR_ID = "00000000-0000-4000-8000-0000000052b1"
const now = () => new Date(1755780000000)

beforeAll(async () => {
  if (BINDING_DIALECT === "sqlite") {
    const { createClient } = await import("@libsql/client")
    const { drizzle } = await import("drizzle-orm/libsql")
    const { migrate } = await import("drizzle-orm/libsql/migrator")
    const client = createClient({ url: BINDING_URL })
    try {
      await migrate(drizzle(client), { migrationsFolder: "src/db/migrations/sqlite" })
    } finally {
      client.close()
    }
  }

  // Idempotent: the remote engines persist between runs.
  await db.delete(menuItems)
  await db.delete(menus)
  await db.delete(blogCategories)
  await db.delete(customPages)
  await db.delete(blogPosts)
  await db.delete(users).where(eq(users.id, ACTOR_ID))

  await db.insert(users).values({
    id: ACTOR_ID,
    name: "Binding Test",
    email: "binding@example.test",
    role: "admin",
    isActive: true,
    createdAt: now(),
    updatedAt: now(),
  })
}, 120_000)

// -- 1. Runtime identity ------------------------------------------------------

describe(`runtime schema identity — ${BINDING_DIALECT}`, () => {
  it("binds the application's tables to the ACTIVE dialect", () => {
    // Not a name comparison: names match in the broken case too. This asserts
    // the column objects are the active dialect's, which is what decides
    // parameter encoding.
    const config =
      BINDING_DIALECT === "sqlite"
        ? sqliteConfig(blogCategories as never)
        : BINDING_DIALECT === "postgresql"
          ? pgConfig(blogCategories as never)
          : mysqlConfig(blogCategories as never)

    expect(config.name).toBe("blog_category")
  })

  it("uses the active dialect's BOOLEAN encoder", () => {
    // THE ASSERTION THAT FAILS UNDER THE PRE-FIX ARCHITECTURE. A canonical
    // SQLiteBoolean encodes true as 1; every other dialect's encodes it as
    // true. This is the whole defect, expressed as one comparison.
    const column = (blogCategories as unknown as Record<string, { mapToDriverValue(v: unknown): unknown }>)
      .isIndexable
    const encoded = column.mapToDriverValue(true)

    if (BINDING_DIALECT === "sqlite") {
      expect(encoded).toBe(1)
    } else {
      expect(encoded, "a boolean must not be encoded as a number outside SQLite").toBe(true)
      expect(typeof encoded).toBe("boolean")
    }
  })

  it("binds every table in the facade to the active dialect", () => {
    // Each branch calls its own reader: the three `getTableConfig` overloads
    // have incompatible signatures, so selecting one into a variable first is
    // not callable under `strict`.
    const read = (table: unknown): string => {
      if (BINDING_DIALECT === "sqlite") return sqliteConfig(table as never).name
      if (BINDING_DIALECT === "postgresql") return pgConfig(table as never).name
      return mysqlConfig(table as never).name
    }

    for (const table of [users, blogPosts, blogCategories, customPages, menus, menuItems, settings]) {
      // Reading a PostgreSQL table with the SQLite reader throws, so a name
      // coming back at all is the assertion.
      expect(() => read(table)).not.toThrow()
      expect(read(table).length).toBeGreaterThan(0)
    }
  })

  it("agrees with the handle's dialect", () => {
    const expected = BINDING_DIALECT === "mariadb" ? "mariadb" : BINDING_DIALECT
    expect(handle.dialect).toBe(expected)
  })
})

// -- 2. Booleans, the proof case ---------------------------------------------

describe(`booleans through application query construction — ${BINDING_DIALECT}`, () => {
  const id = "cat-boolean"

  it("INSERT true stores true", async () => {
    await db.insert(blogCategories).values({
      id,
      name: "Boolean category",
      slug: "boolean-category",
      isIndexable: true,
      createdAt: now(),
      updatedAt: now(),
    })
    const [row] = await db.select().from(blogCategories).where(eq(blogCategories.id, id))
    expect(row.isIndexable).toBe(true)
  })

  it("UPDATE to false stores false", async () => {
    await db.update(blogCategories).set({ isIndexable: false }).where(eq(blogCategories.id, id))
    const [row] = await db.select().from(blogCategories).where(eq(blogCategories.id, id))
    expect(row.isIndexable).toBe(false)
  })

  it("UPDATE back to true stores true", async () => {
    await db.update(blogCategories).set({ isIndexable: true }).where(eq(blogCategories.id, id))
    const [row] = await db.select().from(blogCategories).where(eq(blogCategories.id, id))
    expect(row.isIndexable).toBe(true)
  })

  it("WHERE boolean = true matches", async () => {
    const rows = await db
      .select()
      .from(blogCategories)
      .where(and(eq(blogCategories.id, id), eq(blogCategories.isIndexable, true)))
    expect(rows).toHaveLength(1)
  })

  it("WHERE boolean = false does not match a true row", async () => {
    const rows = await db
      .select()
      .from(blogCategories)
      .where(and(eq(blogCategories.id, id), eq(blogCategories.isIndexable, false)))
    expect(rows).toHaveLength(0)
  })

  it("a boolean survives a SELECT projection", async () => {
    const [row] = await db
      .select({ flag: blogCategories.isIndexable, name: blogCategories.name })
      .from(blogCategories)
      .where(eq(blogCategories.id, id))
    expect(row.flag).toBe(true)
    expect(row.name).toBe("Boolean category")
  })

  it("a SECOND, unrelated boolean table behaves the same", async () => {
    // Guards against fixing one table. `menu_item` carries two booleans that
    // default in opposite directions.
    const menu = await insertReturning(menus, {
      name: "Binding menu",
      location: "primary",
      createdAt: now(),
      updatedAt: now(),
    })
    const item = await insertReturning(menuItems, {
      menuId: menu.id,
      label: "Active item",
      type: "custom",
      target: "/x",
      sortOrder: 0,
      isActive: true,
      opensInNewTab: true,
      createdAt: now(),
      updatedAt: now(),
    })
    const [row] = await db.select().from(menuItems).where(eq(menuItems.id, item.id))
    expect(row.isActive).toBe(true)
    expect(row.opensInNewTab).toBe(true)

    const active = await db
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.menuId, menu.id), eq(menuItems.isActive, true)))
    expect(active).toHaveLength(1)
  })
})

// -- 3. The rest of the type surface -----------------------------------------

describe(`other column types through application binding — ${BINDING_DIALECT}`, () => {
  const id = "page-types"

  it("round-trips text, nullable text, timestamps and a foreign key", async () => {
    await db.insert(customPages).values({
      id,
      title: "Typed page",
      path: "/typed-page",
      content: "<p>body</p>",
      metaTitle: null,
      isPublished: true,
      isIndexable: false,
      publishedAt: now(),
      createdById: ACTOR_ID,
      createdAt: now(),
      updatedAt: now(),
    })

    const [row] = await db.select().from(customPages).where(eq(customPages.id, id))
    expect(row.title).toBe("Typed page")
    expect(row.metaTitle).toBeNull()
    expect(row.isPublished).toBe(true)
    expect(row.isIndexable).toBe(false)
    expect(row.publishedAt).toBeInstanceOf(Date)
    expect(row.publishedAt?.getTime()).toBe(now().getTime())
    expect(row.createdById).toBe(ACTOR_ID)
  })

  it("matches a nullable column with IS NULL", async () => {
    const rows = await db
      .select()
      .from(customPages)
      .where(and(eq(customPages.id, id), isNull(customPages.metaTitle)))
    expect(rows).toHaveLength(1)
  })

  it("matches an integer column", async () => {
    const menu = await db.select().from(menus).limit(1)
    const rows = await db
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.menuId, menu[0].id), eq(menuItems.sortOrder, 0)))
    expect(rows.length).toBeGreaterThan(0)
  })

  it("matches with inArray on a text key", async () => {
    const rows = await db.select().from(customPages).where(inArray(customPages.id, [id, "nope"]))
    expect(rows).toHaveLength(1)
  })

  it("orders by a runtime schema column, both directions", async () => {
    const [menu] = await db.select().from(menus).limit(1)
    await insertReturning(menuItems, {
      menuId: menu.id,
      label: "Second",
      type: "custom",
      target: "/y",
      sortOrder: 5,
      isActive: true,
      opensInNewTab: false,
      createdAt: now(),
      updatedAt: now(),
    })
    const ascending = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.menuId, menu.id))
      .orderBy(asc(menuItems.sortOrder))
    const descending = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.menuId, menu.id))
      .orderBy(desc(menuItems.sortOrder))
    expect(ascending[0].sortOrder).toBeLessThan(ascending[ascending.length - 1].sortOrder)
    expect(descending[0].sortOrder).toBeGreaterThan(descending[descending.length - 1].sortOrder)
  })

  it("joins on runtime schema columns", async () => {
    const rows = await db
      .select({ item: menuItems.label, menu: menus.name, active: menuItems.isActive })
      .from(menuItems)
      .innerJoin(menus, eq(menuItems.menuId, menus.id))
    expect(rows.length).toBeGreaterThan(0)
    expect(typeof rows[0].active).toBe("boolean")
  })
})

// -- 4. The portable write helpers -------------------------------------------

describe(`db/writes helpers under the runtime binding — ${BINDING_DIALECT}`, () => {
  it("insertReturning returns the row it wrote, booleans intact", async () => {
    const row = await insertReturning(blogCategories, {
      id: "cat-writes",
      name: "Writes",
      slug: "writes",
      isIndexable: true,
      createdAt: now(),
      updatedAt: now(),
    })
    expect(row.isIndexable).toBe(true)

    const [stored] = await db.select().from(blogCategories).where(eq(blogCategories.id, "cat-writes"))
    expect(stored.isIndexable).toBe(true)
  })

  it("updateReturning flips a boolean and reports the new value", async () => {
    const row = await updateReturning(
      blogCategories,
      { isIndexable: false, updatedAt: now() },
      eq(blogCategories.id, "cat-writes"),
    )
    expect(row.isIndexable).toBe(false)
  })

  it("upsert inserts, then updates the same row", async () => {
    await upsert(
      settings,
      { id: SETTINGS_SINGLETON_ID, siteName: "Binding A", updatedAt: now() },
      { target: settings.id, set: { siteName: "Binding A", updatedAt: now() } },
    )
    const [first] = await db.select().from(settings).where(eq(settings.id, SETTINGS_SINGLETON_ID))
    expect(first.siteName).toBe("Binding A")

    await upsert(
      settings,
      { id: SETTINGS_SINGLETON_ID, siteName: "Binding B", updatedAt: now() },
      { target: settings.id, set: { siteName: "Binding B", updatedAt: now() } },
    )
    const rows = await db.select().from(settings).where(eq(settings.id, SETTINGS_SINGLETON_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].siteName).toBe("Binding B")
  })

  it("deleteReturning removes by predicate and reports what it removed", async () => {
    const removed = await deleteReturning(blogCategories, eq(blogCategories.id, "cat-writes"))
    expect(removed).toHaveLength(1)
    expect(removed[0].id).toBe("cat-writes")

    const rest = await db.select().from(blogCategories).where(eq(blogCategories.id, "cat-writes"))
    expect(rest).toHaveLength(0)
  })

  it("DELETE with a boolean predicate removes only matching rows", async () => {
    const [menu] = await db.select().from(menus).limit(1)
    await insertReturning(menuItems, {
      menuId: menu.id,
      label: "Inactive",
      type: "custom",
      target: "/z",
      sortOrder: 9,
      isActive: false,
      opensInNewTab: false,
      createdAt: now(),
      updatedAt: now(),
    })

    const before = await db.select().from(menuItems).where(eq(menuItems.menuId, menu.id))
    await db
      .delete(menuItems)
      .where(and(eq(menuItems.menuId, menu.id), eq(menuItems.isActive, false)))
    const after = await db.select().from(menuItems).where(eq(menuItems.menuId, menu.id))

    expect(after.length).toBe(before.length - 1)
    expect(after.every((row) => row.isActive)).toBe(true)
  })
})

// -- 5. Transactions ---------------------------------------------------------

describe(`transactions under the runtime binding — ${BINDING_DIALECT}`, () => {
  it("rolls back a boolean write when the transaction fails", async () => {
    const id = "cat-tx"
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(blogCategories).values({
          id,
          name: "Tx",
          slug: "tx",
          isIndexable: true,
          createdAt: now(),
          updatedAt: now(),
        })
        throw new Error("deliberate rollback")
      }),
    ).rejects.toThrow("deliberate rollback")

    const rows = await db.select().from(blogCategories).where(eq(blogCategories.id, id))
    expect(rows).toHaveLength(0)
  })

  it("commits a boolean write, correctly encoded, inside a transaction", async () => {
    const id = "cat-tx-ok"
    await db.transaction(async (tx) => {
      await tx.insert(blogCategories).values({
        id,
        name: "Tx ok",
        slug: "tx-ok",
        isIndexable: true,
        createdAt: now(),
        updatedAt: now(),
      })
    })
    const [row] = await db.select().from(blogCategories).where(eq(blogCategories.id, id))
    expect(row.isIndexable).toBe(true)
  })
})
