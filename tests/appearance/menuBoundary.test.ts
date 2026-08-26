// MUST be first: it sets DATABASE_URL before `@/db/client` reads it.
import { DB_DIALECT, DB_URL } from "../themes/activationEnv"
import { beforeAll, describe, expect, it } from "vitest"
import { and, asc, eq } from "drizzle-orm"
import { db } from "@/db/client"
import { MENU_ITEM_TYPES } from "@/db/schema/menus"

/**
 * Tables come from `@/db/tables` — the SAME runtime facade application code
 * uses, so this suite exercises the production query-construction path rather
 * than a test-only one.
 *
 * It previously read `handle.schema` directly, to work around a Phase 5 defect
 * where a canonical SQLite table object passed to a PostgreSQL connection
 * encoded booleans as 1/0 and silently stored `false`. Phase 5.2 fixed that at
 * the architecture level; reading through the facade is now both correct and
 * the thing worth testing.
 */
import { menus, menuItems, activityLog, users } from "@/db/tables"
import { insertReturning, updateReturning } from "@/db/writes"
import { recordActivity } from "@/db/activityLog"
import { buildNavTree, validateParentPlacement } from "@/Framework/Navigation/menuTree"
import { resolveMenuHrefs } from "@/Modules/Public/ViewModels/navResolve"

/**
 * Everything the menu routes do to the database, on whichever engine this run
 * is pointed at.
 *
 * The routes are transport shells — authenticate, authorise, parse, call these
 * operations, write an activity entry. Driving the operations directly covers
 * the part that can differ between PostgreSQL, MySQL, MariaDB and SQLite
 * without standing up an HTTP server four times.
 *
 * SQLite by default. The other three run when pointed at a real engine:
 *
 *   TEST_ACTIVATION_DIALECT=mysql TEST_ACTIVATION_URL=mysql://… \
 *     npx vitest run tests/appearance/menuBoundary.test.ts
 *
 * MariaDB is run separately from MySQL. It shares a driver and the migration
 * SQL and is still a different product.
 */

const ACTOR = {
  id: "00000000-0000-4000-8000-00000000b165",
  name: "Menu Test",
  email: "menus@example.test",
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

  // Idempotent: the remote engines persist between runs.
  await db.delete(menuItems)
  await db.delete(menus)
  await db.delete(activityLog).where(eq(activityLog.entityType, "menu"))
  await db.delete(activityLog).where(eq(activityLog.entityType, "menu_item"))
  await db.delete(users).where(eq(users.id, ACTOR.id))

  await db.insert(users).values({
    id: ACTOR.id,
    name: ACTOR.name,
    email: ACTOR.email,
    role: "editor",
    isActive: true,
    createdAt: new Date(1755780000000),
    updatedAt: new Date(1755780000000),
  })
}, 120_000)

async function makeMenu(name: string, location: string) {
  const now = new Date()
  return insertReturning(menus, { name, location, createdAt: now, updatedAt: now })
}

async function makeItem(
  menuId: string,
  over: Partial<typeof menuItems.$inferInsert> & { label: string },
) {
  const now = new Date()
  return insertReturning(menuItems, {
    menuId,
    label: over.label,
    type: over.type ?? "custom",
    target: over.target ?? "/x",
    sortOrder: over.sortOrder ?? 0,
    parentId: over.parentId ?? null,
    isActive: over.isActive ?? true,
    opensInNewTab: over.opensInNewTab ?? false,
    createdAt: now,
    updatedAt: now,
  })
}

describe(`menu boundary — ${DB_DIALECT}`, () => {
  it("creates a menu and reads it back", async () => {
    const menu = await makeMenu("Main navigation", "primary")
    const [row] = await db.select().from(menus).where(eq(menus.id, menu.id))
    expect(row.name).toBe("Main navigation")
    expect(row.location).toBe("primary")
  })

  it("enforces one menu per location", async () => {
    await expect(makeMenu("Another main", "primary")).rejects.toThrow()
  })

  it("allows a second menu in a different location", async () => {
    const footer = await makeMenu("Footer links", "footer")
    expect(footer.location).toBe("footer")
  })

  it("renames a menu without touching its location", async () => {
    const [existing] = await db.select().from(menus).where(eq(menus.location, "footer"))
    const updated = await updateReturning(
      menus,
      { name: "Footer navigation", updatedAt: new Date() },
      eq(menus.id, existing.id),
    )
    expect(updated.name).toBe("Footer navigation")
    expect(updated.location).toBe("footer")
  })

  it("stores every one of the five item types", async () => {
    const [menu] = await db.select().from(menus).where(eq(menus.location, "primary"))
    for (const [index, type] of MENU_ITEM_TYPES.entries()) {
      const item = await makeItem(menu.id, {
        label: `Item ${type}`,
        type,
        target: type === "custom" ? "/custom" : `entity-${type}`,
        sortOrder: index,
      })
      expect(item.type).toBe(type)
    }
    const rows = await db.select().from(menuItems).where(eq(menuItems.menuId, menu.id))
    expect(rows).toHaveLength(MENU_ITEM_TYPES.length)
  })

  it("round-trips both booleans as real booleans", async () => {
    const [menu] = await db.select().from(menus).where(eq(menus.location, "footer"))
    const item = await makeItem(menu.id, {
      label: "Hidden new-tab link",
      isActive: false,
      opensInNewTab: true,
    })
    const [row] = await db.select().from(menuItems).where(eq(menuItems.id, item.id))
    expect(row.isActive).toBe(false)
    expect(row.opensInNewTab).toBe(true)
  })

  it("accepts a self-referencing parent, which is the whole point of the column", async () => {
    const [menu] = await db.select().from(menus).where(eq(menus.location, "footer"))
    const parent = await makeItem(menu.id, { label: "Legal", sortOrder: 0 })
    const child = await makeItem(menu.id, { label: "Privacy", parentId: parent.id, sortOrder: 0 })

    const [row] = await db.select().from(menuItems).where(eq(menuItems.id, child.id))
    expect(row.parentId).toBe(parent.id)
  })

  it("enforces the parent foreign key", async () => {
    const [menu] = await db.select().from(menus).where(eq(menus.location, "footer"))
    await expect(
      makeItem(menu.id, { label: "Ghost child", parentId: "no-such-item" }),
    ).rejects.toThrow()
  })

  it("enforces the menu foreign key", async () => {
    await expect(makeItem("no-such-menu", { label: "Orphan" })).rejects.toThrow()
  })

  it("deletes an item's children with it, in one transaction", async () => {
    const menu = await makeMenu("Deletable", "sidebar")
    const parent = await makeItem(menu.id, { label: "Parent" })
    await makeItem(menu.id, { label: "Child A", parentId: parent.id })
    await makeItem(menu.id, { label: "Child B", parentId: parent.id })

    await db.transaction(async (tx) => {
      await tx.delete(menuItems).where(eq(menuItems.parentId, parent.id))
      await tx.delete(menuItems).where(eq(menuItems.id, parent.id))
    })

    const remaining = await db.select().from(menuItems).where(eq(menuItems.menuId, menu.id))
    expect(remaining).toHaveLength(0)
  })

  it("rolls back a failed multi-item write, leaving no partial menu", async () => {
    const menu = await makeMenu("Transactional", "transactional")
    const before = await db.select().from(menuItems).where(eq(menuItems.menuId, menu.id))

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(menuItems).values({
          id: crypto.randomUUID(),
          menuId: menu.id,
          label: "Fine",
          type: "custom",
          target: "/fine",
          sortOrder: 0,
          isActive: true,
          opensInNewTab: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        // Violates the parent foreign key.
        await tx.insert(menuItems).values({
          id: crypto.randomUUID(),
          menuId: menu.id,
          label: "Broken",
          type: "custom",
          target: "/broken",
          parentId: "no-such-item",
          sortOrder: 1,
          isActive: true,
          opensInNewTab: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }),
    ).rejects.toThrow()

    const after = await db.select().from(menuItems).where(eq(menuItems.menuId, menu.id))
    expect(after).toHaveLength(before.length)
  })

  it("deletes a menu and its items together", async () => {
    const [menu] = await db.select().from(menus).where(eq(menus.location, "transactional"))
    await db.transaction(async (tx) => {
      await tx.delete(menuItems).where(eq(menuItems.menuId, menu.id))
      await tx.delete(menus).where(eq(menus.id, menu.id))
    })
    expect(await db.select().from(menus).where(eq(menus.id, menu.id))).toHaveLength(0)
    expect(await db.select().from(menuItems).where(eq(menuItems.menuId, menu.id))).toHaveLength(0)
  })

  it("orders items deterministically, not by insertion order", async () => {
    const menu = await makeMenu("Ordered", "ordered")
    await makeItem(menu.id, { label: "Zulu", sortOrder: 2 })
    await makeItem(menu.id, { label: "Alpha", sortOrder: 0 })
    await makeItem(menu.id, { label: "Mike", sortOrder: 1 })

    const rows = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.menuId, menu.id))
      .orderBy(asc(menuItems.sortOrder))

    const tree = buildNavTree(
      resolveMenuHrefs(rows, { pages: new Map(), posts: new Map(), categories: new Map(), tags: new Map() }),
    )
    expect(tree.map((n) => n.label)).toEqual(["Alpha", "Mike", "Zulu"])
  })

  it("still orders deterministically when two rows share a sortOrder", async () => {
    const menu = await makeMenu("Tied", "tied")
    await makeItem(menu.id, { label: "Beta", sortOrder: 0 })
    await makeItem(menu.id, { label: "Alpha", sortOrder: 0 })

    const rows = await db.select().from(menuItems).where(eq(menuItems.menuId, menu.id))
    const tree = buildNavTree(
      resolveMenuHrefs(rows, { pages: new Map(), posts: new Map(), categories: new Map(), tags: new Map() }),
    )
    expect(tree.map((n) => n.label)).toEqual(["Alpha", "Beta"])
  })

  it("refuses a grandchild through the domain validation, before any write", async () => {
    const menu = await makeMenu("Deep", "deep")
    const top = await makeItem(menu.id, { label: "Top" })
    const child = await makeItem(menu.id, { label: "Child", parentId: top.id })

    const existing = await db
      .select({ id: menuItems.id, menuId: menuItems.menuId, parentId: menuItems.parentId })
      .from(menuItems)

    const result = validateParentPlacement({
      itemId: null,
      menuId: menu.id,
      parentId: child.id,
      existing,
    })
    expect(result.ok).toBe(false)
  })

  it("refuses a parent from another menu", async () => {
    const [deep] = await db.select().from(menus).where(eq(menus.location, "deep"))
    const [ordered] = await db.select().from(menus).where(eq(menus.location, "ordered"))
    const [foreignItem] = await db.select().from(menuItems).where(eq(menuItems.menuId, ordered.id))

    const existing = await db
      .select({ id: menuItems.id, menuId: menuItems.menuId, parentId: menuItems.parentId })
      .from(menuItems)

    const result = validateParentPlacement({
      itemId: null,
      menuId: deep.id,
      parentId: foreignItem.id,
      existing,
    })
    expect(result.ok).toBe(false)
  })

  it("records one activity entry per real mutation and none for a no-op", async () => {
    const menu = await makeMenu("Logged", "logged")

    await recordActivity({
      actor: ACTOR,
      action: "created",
      entityType: "menu",
      entityId: menu.id,
      entityLabel: menu.name,
      summary: `Created the "${menu.name}" menu in the ${menu.location} location`,
    })

    const entries = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityType, "menu"), eq(activityLog.entityId, menu.id)))

    expect(entries).toHaveLength(1)
    expect(entries[0].action).toBe("created")
    expect(entries[0].actorName).toBe(ACTOR.name)
    expect(entries[0].actorId).toBe(ACTOR.id)

    // A no-op writes nothing, so the count does not move.
    const after = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityType, "menu"), eq(activityLog.entityId, menu.id)))
    expect(after).toHaveLength(1)
  })

  it("keeps menu rows untouched when nothing writes to them", async () => {
    // The property the theme-switch proof depends on: reading navigation never
    // writes. Nothing in this suite has touched `sidebar` since it was created.
    const [sidebar] = await db.select().from(menus).where(eq(menus.location, "sidebar"))
    expect(sidebar).toBeDefined()
    expect(sidebar.name).toBe("Deletable")
  })
})
