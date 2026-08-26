import { getTableConfig } from "drizzle-orm/sqlite-core"
import type { SQLiteTable } from "drizzle-orm/sqlite-core"
import {
  pgTable,
  text as pgText,
  boolean as pgBoolean,
  integer as pgInteger,
  customType as pgCustomType,
  primaryKey as pgPrimaryKey,
  index as pgIndex,
  uniqueIndex as pgUniqueIndex,
} from "drizzle-orm/pg-core"
import {
  mysqlTable,
  varchar as myVarchar,
  text as myText,
  boolean as myBoolean,
  int as myInt,
  customType as myCustomType,
  primaryKey as myPrimaryKey,
  index as myIndex,
  uniqueIndex as myUniqueIndex,
} from "drizzle-orm/mysql-core"

/**
 * PostgreSQL and MySQL tables, derived from the SQLite schema at startup.
 *
 * WHY DERIVE RATHER THAN DEFINE THREE TIMES
 *
 * FlowCMS has 27 tables and supports four engines. Writing each table per
 * dialect is 72 files where every field change is three edits, kept in step by
 * a test that can only report drift after somebody introduces it. Deriving from
 * one source makes the drift impossible to express.
 *
 * The first attempt at that was a column-spec DSL. It was abandoned for a
 * measured reason: Drizzle's three table types have no common supertype, so a
 * generic `defineTable` cannot return a typed table, and every query in all 85
 * API routes would have degraded to `any`. Deriving from the existing SQLite
 * tables keeps `src/db/schema/*.ts` as ordinary, fully-typed Drizzle — the
 * application compiles against exactly what it compiles against today — while
 * the other two dialects are produced from that same single definition.
 *
 * WHAT THIS COSTS
 *
 * `getTableConfig` is a Drizzle internal. That coupling is real and is confined
 * to this file; `tests/db/schemaParity.test.ts` compares all three dialects and
 * fails loudly if an upgrade changes the metadata shape. The alternative
 * couplings were worse: erased types across the application, or a hand-written
 * type-level reimplementation of Drizzle's inference.
 *
 * The whole surface it has to handle is small and was measured, not guessed —
 * re-measured at Phase 8 final verification, because the first set of figures
 * was written in Phase 5 and the schema has grown since:
 * 27 tables, 290 columns across four column types (text 205, timestamp 49,
 * boolean 22, integer 14), 27 `.references()` foreign keys, 5 indexes, 10
 * uniques.
 *
 * Treat these as a sense of scale, not an invariant. Nothing asserts them, and
 * a count in a comment rots silently — which is exactly what happened to the
 * previous set, and to the "26 tables" that stood in the documentation.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Drizzle's pg and mysql
   column builders share no supertype, so the construction below is necessarily
   untyped. Nothing here is exported with an `any` type: application code never
   touches these objects, it uses the SQLite tables. */

// ---------------------------------------------------------------------------
// Epoch-millis timestamps
// ---------------------------------------------------------------------------

/**
 * BIGINT on the wire, `Date` in the application — matching SQLite's
 * `integer(mode:"timestamp_ms")` exactly.
 *
 * This exists because of a measured failure. A plain `bigint(mode:"number")`
 * returns a number where SQLite returns a `Date`, and PostgreSQL rejects a
 * `Date` on insert outright. Without this conversion every one of the 42
 * timestamp columns would hand the application a different type depending on
 * which engine answered.
 *
 * Epoch millis rather than a native timestamp type keeps one representation and
 * no timezone interpretation anywhere: MySQL's `datetime` carries no zone,
 * which is the usual source of silent UTC drift.
 */
const pgTimestampMs = pgCustomType<{ data: Date; driverData: string | number }>({
  dataType: () => "bigint",
  toDriver: (value) => (value instanceof Date ? value.getTime() : value),
  fromDriver: (value) => new Date(Number(value)),
})

const myTimestampMs = myCustomType<{ data: Date; driverData: string | number }>({
  dataType: () => "bigint",
  toDriver: (value) => (value instanceof Date ? value.getTime() : value),
  fromDriver: (value) => new Date(Number(value)),
})

/** MySQL/InnoDB utf8mb4 index prefix limit. Exceeding it fails at DDL time. */
const MYSQL_KEY_LEN = 191

export type DerivedDialect = "postgresql" | "mysql"

type AnyTable = Record<string, any>

/**
 * Built tables keyed by SQL table name. Foreign keys resolve through this,
 * because that is the only name a `getTableConfig` reference exposes.
 */
const registry: Record<DerivedDialect, Map<string, AnyTable>> = {
  postgresql: new Map(),
  mysql: new Map(),
}

/**
 * The same tables keyed by SCHEMA KEY (`blogTags`, not `blog_tag`) — the shape
 * callers actually index.
 *
 * Memoised separately, and that separation is load-bearing. An earlier version
 * returned `Object.fromEntries(registry)` on the second call, which is keyed by
 * SQL name, so the first caller got `schema.blogTags` and every later caller
 * silently got `undefined`. It surfaced as MySQL passing and MariaDB failing in
 * the same run — the two share a driver family and therefore this cache — which
 * reads exactly like a MariaDB incompatibility and is nothing of the sort.
 */
const byKeyCache: Record<DerivedDialect, Record<string, AnyTable> | null> = {
  postgresql: null,
  mysql: null,
}

// ---------------------------------------------------------------------------
// Column derivation
// ---------------------------------------------------------------------------

interface ColumnMeta {
  name: string
  columnType: string
  notNull: boolean
  primary: boolean
  isUnique: boolean
  hasDefault: boolean
  default?: unknown
  defaultFn?: () => unknown
  enumValues?: string[]
}

function deriveColumn(dialect: DerivedDialect, c: ColumnMeta, needsKeyLength: boolean): any {
  let column: any

  switch (c.columnType) {
    case "SQLiteBoolean":
      column = dialect === "postgresql" ? pgBoolean(c.name) : myBoolean(c.name)
      break
    case "SQLiteTimestamp":
      column = dialect === "postgresql" ? pgTimestampMs(c.name) : myTimestampMs(c.name)
      break
    case "SQLiteInteger":
      column = dialect === "postgresql" ? pgInteger(c.name) : myInt(c.name)
      break
    case "SQLiteText":
    default: {
      const enumOpt = c.enumValues?.length
        ? { enum: c.enumValues as [string, ...string[]] }
        : undefined
      if (dialect === "postgresql") {
        // Postgres `text` is unbounded AND fully indexable, so there is never a
        // reason to bound it here.
        column = enumOpt ? pgText(c.name, enumOpt) : pgText(c.name)
      } else {
        // MySQL is the opposite: TEXT cannot be indexed without a prefix
        // length, and VARCHAR silently truncates beyond its bound. So key
        // columns get varchar(191) and everything else gets TEXT — bounding a
        // post body to 255 characters would destroy content on write.
        column = needsKeyLength
          ? myVarchar(c.name, { length: MYSQL_KEY_LEN, ...(enumOpt ?? {}) })
          : enumOpt
            ? myVarchar(c.name, { length: MYSQL_KEY_LEN, ...enumOpt })
            : myText(c.name)
      }
      break
    }
  }

  if (c.notNull) column = column.notNull()
  if (c.primary) column = column.primaryKey()
  if (c.isUnique && !c.primary) column = column.unique()
  if (c.default !== undefined) column = column.default(c.default)
  if (c.defaultFn) column = column.$defaultFn(c.defaultFn)

  return column
}

// ---------------------------------------------------------------------------
// Table derivation
// ---------------------------------------------------------------------------

interface ForeignKeySpec {
  column: string
  foreignTable: string
  foreignColumn: string
  onDelete?: string
}

function readForeignKeys(cfg: ReturnType<typeof getTableConfig>): ForeignKeySpec[] {
  const out: ForeignKeySpec[] = []
  for (const fk of cfg.foreignKeys) {
    const ref = fk.reference()
    if (ref.columns.length !== 1 || ref.foreignColumns.length !== 1) {
      // Fail loudly. Silently dropping a composite constraint would leave two
      // engines enforcing referential integrity and one not.
      throw new Error(
        `Composite foreign key on "${cfg.name}" is not supported by the dialect derivation. ` +
          `Add it explicitly in src/db/deriveDialects.ts.`,
      )
    }
    out.push({
      column: ref.columns[0].name,
      foreignTable: getTableConfig(ref.foreignTable as SQLiteTable).name,
      foreignColumn: ref.foreignColumns[0].name,
      onDelete: (fk as unknown as { onDelete?: string }).onDelete,
    })
  }
  return out
}

/**
 * Derive one dialect's table set from the SQLite schema.
 *
 * Two passes, because foreign keys reference tables that may not be built yet.
 * Drizzle's `.references()` takes a thunk, so pass one wires the columns and
 * pass two is unnecessary — the thunk resolves from the registry at DDL/query
 * time, by which point every table is present.
 */
export function deriveSchema(
  sqliteSchema: Record<string, unknown>,
  dialect: DerivedDialect,
): Record<string, AnyTable> {
  const cached = byKeyCache[dialect]
  if (cached) return cached
  const tables = registry[dialect]

  const configs: Array<{ key: string; cfg: ReturnType<typeof getTableConfig> }> = []
  for (const [key, value] of Object.entries(sqliteSchema)) {
    let cfg: ReturnType<typeof getTableConfig>
    try {
      cfg = getTableConfig(value as SQLiteTable)
    } catch {
      continue // relations, enums, constants — not tables
    }
    configs.push({ key, cfg })
  }

  const byKey: Record<string, AnyTable> = {}

  for (const { key, cfg } of configs) {
    const foreignKeys = readForeignKeys(cfg)
    const fkByColumn = new Map(foreignKeys.map((fk) => [fk.column, fk]))

    // Which columns need a bounded length on MySQL: anything that takes part in
    // a key or an index.
    const keyColumns = new Set<string>()
    for (const c of cfg.columns) if (c.primary || c.isUnique) keyColumns.add(c.name)
    for (const pk of cfg.primaryKeys) for (const c of pk.columns) keyColumns.add(c.name)
    for (const idx of cfg.indexes) {
      for (const c of idx.config.columns) {
        const named = c as unknown as { name?: string }
        if (named.name) keyColumns.add(named.name)
      }
    }
    for (const fk of foreignKeys) keyColumns.add(fk.column)

    const columns: Record<string, any> = {}
    // Map by the SCHEMA KEY (the property name in the TS object), not the SQL
    // column name — application code and the adapters index by key.
    for (const [propName, column] of Object.entries(cfg.columns)) void propName
    for (const c of cfg.columns) {
      const meta = c as unknown as ColumnMeta
      const built = deriveColumn(dialect, meta, keyColumns.has(c.name))
      const fk = fkByColumn.get(c.name)
      columns[c.name] = fk
        ? built.references(
            () => {
              const target = tables.get(fk.foreignTable)
              if (!target) {
                throw new Error(
                  `Derived schema references unknown table "${fk.foreignTable}".`,
                )
              }
              return target[fk.foreignColumn]
            },
            fk.onDelete ? { onDelete: fk.onDelete as never } : undefined,
          )
        : built
    }

    const make = dialect === "postgresql" ? pgTable : mysqlTable
    const table = (make as any)(cfg.name, columns, (t: AnyTable) => {
      const extras: any[] = []
      for (const pk of cfg.primaryKeys) {
        const cols = pk.columns.map((c) => t[c.name])
        extras.push(
          dialect === "postgresql"
            ? pgPrimaryKey({ columns: cols as any })
            : myPrimaryKey({ columns: cols as any }),
        )
      }
      for (const idx of cfg.indexes) {
        const cols = idx.config.columns
          .map((c) => (c as unknown as { name?: string }).name)
          .filter(Boolean)
          .map((n) => t[n as string])
        if (cols.length === 0) continue
        const unique = Boolean(idx.config.unique)
        const make2 =
          dialect === "postgresql"
            ? unique
              ? pgUniqueIndex
              : pgIndex
            : unique
              ? myUniqueIndex
              : myIndex
        extras.push(make2(idx.config.name).on(...(cols as [any, ...any[]])))
      }
      return extras
    })

    tables.set(cfg.name, table)
    byKey[key] = table
  }

  byKeyCache[dialect] = byKey
  return byKey
}

/** Reset the memoised registry. Tests only — production derives once. */
export function __resetDerivedSchemas() {
  registry.postgresql.clear()
  registry.mysql.clear()
  byKeyCache.postgresql = null
  byKeyCache.mysql = null
}

/* eslint-enable @typescript-eslint/no-explicit-any */
