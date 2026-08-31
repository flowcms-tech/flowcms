import { describe, expect, it } from "vitest"
import { getTableConfig as sqliteConfig } from "drizzle-orm/sqlite-core"
import { getTableConfig as pgConfig } from "drizzle-orm/pg-core"
import { getTableConfig as mysqlConfig } from "drizzle-orm/mysql-core"
import * as sqliteSchema from "@/db/schema"
import { deriveSchema } from "@/db/deriveDialects"

/**
 * Logical parity across the three dialects.
 *
 * Physical types are expected to differ — that is the entire point of having
 * three dialects. What must never differ is anything the application can
 * observe: which tables exist, what their columns are called, whether a value
 * may be null, what is a key, and what is unique. A column that is `notNull` on
 * PostgreSQL and nullable on MySQL is not a portability detail, it is two
 * different products sharing a name.
 *
 * This test also guards the one real cost of deriving rather than hand-writing:
 * `getTableConfig` is a Drizzle internal. If an upgrade changes its shape, the
 * derivation degrades — and this fails rather than shipping a schema quietly
 * missing its constraints.
 */

const derived = {
  postgresql: deriveSchema(sqliteSchema as Record<string, unknown>, "postgresql"),
  mysql: deriveSchema(sqliteSchema as Record<string, unknown>, "mysql"),
}

interface Normalized {
  name: string
  columns: Array<{ name: string; notNull: boolean; primary: boolean; unique: boolean }>
  compositePrimaryKeys: string[][]
  indexes: Array<{ name: string; columns: string[]; unique: boolean }>
  foreignKeys: Array<{ from: string[]; to: string[] }>
}

function normalize(cfg: {
  name: string
  columns: ReadonlyArray<{ name: string; notNull: boolean; primary: boolean; isUnique: boolean }>
  primaryKeys: ReadonlyArray<{ columns: ReadonlyArray<{ name: string }> }>
  indexes: ReadonlyArray<{ config: { name: string; columns: ReadonlyArray<unknown>; unique?: boolean } }>
  foreignKeys: ReadonlyArray<{ reference: () => { columns: ReadonlyArray<{ name: string }>; foreignColumns: ReadonlyArray<{ name: string }> } }>
}): Normalized {
  return {
    name: cfg.name,
    columns: [...cfg.columns]
      .map((c) => ({ name: c.name, notNull: c.notNull, primary: c.primary, unique: c.isUnique }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    compositePrimaryKeys: cfg.primaryKeys
      .map((pk) => pk.columns.map((c) => c.name).sort())
      .sort((a, b) => a.join().localeCompare(b.join())),
    indexes: cfg.indexes
      .map((i) => ({
        name: i.config.name,
        columns: i.config.columns
          .map((c) => (c as { name?: string }).name ?? "")
          .filter(Boolean)
          .sort(),
        unique: Boolean(i.config.unique),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    foreignKeys: cfg.foreignKeys
      .map((fk) => {
        const ref = fk.reference()
        return {
          from: ref.columns.map((c) => c.name).sort(),
          to: ref.foreignColumns.map((c) => c.name).sort(),
        }
      })
      .sort((a, b) => a.from.join().localeCompare(b.from.join())),
  }
}

function sqliteTables() {
  const out: Record<string, Normalized> = {}
  for (const [key, value] of Object.entries(sqliteSchema)) {
    try {
      const cfg = sqliteConfig(value as never)
      out[key] = normalize(cfg as never)
    } catch {
      /* not a table */
    }
  }
  return out
}

const sqlite = sqliteTables()

describe("schema parity", () => {
  it("derives every SQLite table into both dialects", () => {
    const expected = Object.keys(sqlite).sort()
    // 27 before Phase 4; `storage_migration` and `storage_migration_entry`
    // make 29. The count is asserted so a table cannot be added to the
    // canonical schema and silently fail to derive into the other two dialects.
    expect(expected.length).toBe(29)
    expect(Object.keys(derived.postgresql).sort()).toEqual(expected)
    expect(Object.keys(derived.mysql).sort()).toEqual(expected)
  })

  for (const key of Object.keys(sqlite)) {
    it(`${key}: identical logical shape across sqlite, postgresql and mysql`, () => {
      const base = sqlite[key]
      const pg = normalize(pgConfig(derived.postgresql[key] as never) as never)
      const my = normalize(mysqlConfig(derived.mysql[key] as never) as never)

      expect(pg.name, "table name").toEqual(base.name)
      expect(my.name, "table name").toEqual(base.name)

      expect(pg.columns, "columns/nullability/keys").toEqual(base.columns)
      expect(my.columns, "columns/nullability/keys").toEqual(base.columns)

      expect(pg.compositePrimaryKeys).toEqual(base.compositePrimaryKeys)
      expect(my.compositePrimaryKeys).toEqual(base.compositePrimaryKeys)

      expect(pg.indexes).toEqual(base.indexes)
      expect(my.indexes).toEqual(base.indexes)

      expect(pg.foreignKeys).toEqual(base.foreignKeys)
      expect(my.foreignKeys).toEqual(base.foreignKeys)
    })
  }
})

describe("derivation guards", () => {
  it("carries every foreign key across, so referential integrity is not dialect-dependent", () => {
    const count = (tables: Record<string, unknown>, cfgFn: (t: never) => { foreignKeys: unknown[] }) =>
      Object.values(tables).reduce<number>((n, t) => n + cfgFn(t as never).foreignKeys.length, 0)

    const base = Object.values(sqlite).reduce((n, t) => n + t.foreignKeys.length, 0)
    // 27 before Phase 4; `storage_migration_entry.migrationId` makes 28.
    expect(base).toBe(28)
    expect(count(derived.postgresql, (t) => pgConfig(t) as never)).toBe(base)
    expect(count(derived.mysql, (t) => mysqlConfig(t) as never)).toBe(base)
  })

  it("bounds MySQL key columns but never bounds free text", () => {
    // The failure this prevents is silent data loss: varchar(255) on a post
    // body truncates articles on write. Key columns must be bounded (InnoDB
    // cannot index unbounded TEXT); everything else must not be.
    const posts = mysqlConfig(derived.mysql.blogPosts as never)
    const content = posts.columns.find((c) => c.name === "content")
    const slug = posts.columns.find((c) => c.name === "slug")

    expect(content?.columnType, "post body must be unbounded TEXT").toBe("MySqlText")
    expect(slug?.columnType, "indexed column must be bounded VARCHAR").toBe("MySqlVarChar")
  })
})
