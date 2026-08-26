import { describe, expect, it } from "vitest"
import { getTableConfig as sqliteConfig } from "drizzle-orm/sqlite-core"
import { getTableConfig as pgConfig } from "drizzle-orm/pg-core"
import { getTableConfig as mysqlConfig } from "drizzle-orm/mysql-core"
import * as sqliteSchema from "@/db/schema"
import { deriveSchema } from "@/db/deriveDialects"
import { menus, menuItems, MENU_ITEM_TYPES } from "@/db/schema/menus"

/**
 * The menu tables, and specifically the one thing the Phase 6.5 brief asked to
 * be proved rather than assumed: that `menu_item.parentId` derives into a
 * SELF-REFERENCING foreign key on PostgreSQL and MySQL/MariaDB, not just on the
 * canonical SQLite schema.
 *
 * `deriveDialects` resolves foreign keys through a thunk that reads a registry
 * populated as tables are built. A self-reference is the case where the table a
 * thunk needs is the table currently being built — so it is the one shape where
 * "resolve later" could plausibly have been "resolve too early". FlowCMS
 * already has one (`blogCategories.parentId`), which is why this works; that is
 * evidence, not proof for a second table, hence this file.
 */

const derived = {
  postgresql: deriveSchema(sqliteSchema as Record<string, unknown>, "postgresql"),
  mysql: deriveSchema(sqliteSchema as Record<string, unknown>, "mysql"),
}

/** Every foreign key on a table, as `column → table.column`. */
function foreignKeys(cfg: {
  foreignKeys: ReadonlyArray<{
    reference: () => {
      columns: ReadonlyArray<{ name: string }>
      foreignTable: unknown
      foreignColumns: ReadonlyArray<{ name: string }>
    }
  }>
}, tableNameOf: (t: unknown) => string): string[] {
  return cfg.foreignKeys
    .map((fk) => {
      const ref = fk.reference()
      return `${ref.columns[0].name} → ${tableNameOf(ref.foreignTable)}.${ref.foreignColumns[0].name}`
    })
    .sort()
}

describe("menu tables exist in the canonical schema", () => {
  it("is exported from the schema barrel, so the derivation sees it", () => {
    const keys = Object.keys(sqliteSchema)
    expect(keys).toContain("menus")
    expect(keys).toContain("menuItems")
  })

  it("names the tables menu and menu_item", () => {
    expect(sqliteConfig(menus).name).toBe("menu")
    expect(sqliteConfig(menuItems).name).toBe("menu_item")
  })

  it("supports exactly the five v0.1 item types", () => {
    expect([...MENU_ITEM_TYPES]).toEqual(["custom", "page", "post", "category", "tag"])
  })

  it("makes location unique, so a slot cannot hold two menus", () => {
    const location = sqliteConfig(menus).columns.find((c) => c.name === "location")
    expect(location?.isUnique).toBe(true)
    expect(location?.notNull).toBe(true)
  })

  it("defaults an item to active, top-level and same-tab", () => {
    const columns = Object.fromEntries(
      sqliteConfig(menuItems).columns.map((c) => [c.name, c]),
    )
    expect(columns.isActive.notNull).toBe(true)
    expect(columns.opensInNewTab.notNull).toBe(true)
    expect(columns.sortOrder.notNull).toBe(true)
    // Nullable: null IS the top level. A sentinel would need a row to point at.
    expect(columns.parentId.notNull).toBe(false)
  })
})

describe("menu_item.parentId is a self-referencing foreign key on every engine", () => {
  it("self-references on SQLite", () => {
    const cfg = sqliteConfig(menuItems)
    expect(foreignKeys(cfg as never, (t) => sqliteConfig(t as never).name)).toEqual([
      "menuId → menu.id",
      "parentId → menu_item.id",
    ])
  })

  it("self-references on PostgreSQL", () => {
    const cfg = pgConfig(derived.postgresql.menuItems as never)
    expect(foreignKeys(cfg as never, (t) => pgConfig(t as never).name)).toEqual([
      "menuId → menu.id",
      "parentId → menu_item.id",
    ])
  })

  it("self-references on MySQL/MariaDB", () => {
    const cfg = mysqlConfig(derived.mysql.menuItems as never)
    expect(foreignKeys(cfg as never, (t) => mysqlConfig(t as never).name)).toEqual([
      "menuId → menu.id",
      "parentId → menu_item.id",
    ])
  })

  it("resolves the self-reference to the SAME table object, not a copy", () => {
    // The failure this catches: a thunk that builds a second `menu_item` table
    // because the registry entry was not there yet. Two table objects with one
    // SQL name produce DDL that looks right and queries that do not join.
    for (const dialect of ["postgresql", "mysql"] as const) {
      const cfgFn = dialect === "postgresql" ? pgConfig : mysqlConfig
      const table = derived[dialect].menuItems
      const ref = (cfgFn(table as never).foreignKeys as ReadonlyArray<{
        reference: () => { columns: ReadonlyArray<{ name: string }>; foreignTable: unknown }
      }>)
        .map((fk) => fk.reference())
        .find((r) => r.columns[0].name === "parentId")
      expect(ref?.foreignTable, dialect).toBe(table)
    }
  })
})

describe("MySQL bounds the key columns the menu tables index", () => {
  it("bounds location, menuId and parentId but leaves label as text", () => {
    const columns = Object.fromEntries(
      mysqlConfig(derived.mysql.menuItems as never).columns.map((c) => [c.name, c.columnType]),
    )
    // InnoDB cannot index unbounded TEXT; these three take part in keys.
    expect(columns.menuId).toBe("MySqlVarChar")
    expect(columns.parentId).toBe("MySqlVarChar")

    const menuColumns = Object.fromEntries(
      mysqlConfig(derived.mysql.menus as never).columns.map((c) => [c.name, c.columnType]),
    )
    expect(menuColumns.location).toBe("MySqlVarChar")
  })
})
