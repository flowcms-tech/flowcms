import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { getTableConfig } from "drizzle-orm/sqlite-core"
import * as canonicalSchema from "@/db/schema"

/**
 * Runtime queries must be built from the ACTIVE dialect's table objects.
 *
 * THE DEFECT THIS PREVENTS, precisely:
 *
 *   Drizzle takes a parameter's encoder from the COLUMN OBJECT a query was
 *   built with, not from the database instance that executes it. So
 *   `db.insert(canonicalSqliteTable).values({ isIndexable: true })` against
 *   PostgreSQL emits correct SQL text and the WRONG parameter — `SQLiteBoolean`
 *   encodes `true` as `1`, and PostgreSQL stores `1` in a boolean column as
 *   **false**. Nothing errors. The row is silently wrong.
 *
 * It shipped for two phases because the database contract suite used
 * `handle.schema` — the derived tables — which is not the access pattern the
 * application used. This test closes that gap at the import level; the
 * behavioural half lives in `tests/db/applicationBinding.test.ts`.
 *
 * WHAT IS AND IS NOT FORBIDDEN
 *
 * Importing a TABLE object from `@/db/schema/**` into runtime code is
 * forbidden. Importing a dialect-free CONSTANT (`SETTINGS_SINGLETON_ID`,
 * `MENU_ITEM_TYPES`, …) is fine — those are not part of the derived schema and
 * reading them from the runtime facade would return `undefined`. Type-only
 * imports are fine: they are erased and couple nothing.
 *
 * The forbidden set is computed from the schema itself rather than hardcoded,
 * so a table added tomorrow is covered without anyone remembering to add it.
 */

const SRC = join(process.cwd(), "src")

/** Every canonical table's export name, discovered rather than listed. */
const TABLE_NAMES = new Set(
  Object.entries(canonicalSchema)
    .filter(([, value]) => {
      try {
        getTableConfig(value as never)
        return true
      } catch {
        return false
      }
    })
    .map(([key]) => key),
)

/**
 * Files allowed to import canonical TABLE objects, each for a stated reason.
 * All are build/derivation machinery; none constructs a runtime query.
 */
const ALLOWED = new Map<string, string>([
  ["src/db/createDatabase.ts", "derives the dialect schemas from the canonical one"],
  ["src/db/deriveDialects.ts", "the derivation itself"],
  ["src/db/tables.ts", "the runtime facade — it re-exports the active dialect's tables"],
  ["src/db/schema.postgresql.ts", "drizzle-kit migration generation only; the app never imports it"],
  ["src/db/schema.mysql.ts", "drizzle-kit migration generation only; the app never imports it"],
])

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(full) ? [full] : []
  })
}

const rel = (file: string) => relative(process.cwd(), file).split(sep).join("/")

/** Value imports only — `import type { … }` is stripped first. */
const TYPE_IMPORT = /import\s+type\s+[\s\S]*?from\s+["'][^"']+["']/g
const SCHEMA_IMPORT =
  /import\s+(?:\*\s+as\s+\w+|\{([^}]*)\})\s+from\s+["'](?:@\/db\/schema|\.\/schema|\.\.\/schema|\.\.\/\.\.\/db\/schema)([^"']*)["']/g

interface Violation {
  file: string
  names: string[]
}

function scan(): Violation[] {
  const violations: Violation[] = []

  for (const file of walk(SRC)) {
    const r = rel(file)
    if (r.startsWith("src/db/schema/")) continue // the definitions themselves
    if (ALLOWED.has(r)) continue

    const source = readFileSync(file, "utf8").replace(TYPE_IMPORT, "")

    for (const match of source.matchAll(SCHEMA_IMPORT)) {
      const named = match[1]
      if (named === undefined) {
        // `import * as schema from "…/schema"` — a namespace import brings every
        // table in, so it cannot be checked name by name.
        violations.push({ file: r, names: ["* (namespace import)"] })
        continue
      }
      const offending = named
        .split(",")
        .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
        .filter((n) => n.length > 0 && TABLE_NAMES.has(n))
      if (offending.length > 0) violations.push({ file: r, names: offending })
    }
  }

  return violations
}

describe("the guard itself is wired up", () => {
  it("discovered the canonical tables", () => {
    // A discovery bug that found nothing would let every assertion below pass
    // against an empty set.
    expect(TABLE_NAMES.size).toBeGreaterThanOrEqual(26)
    expect(TABLE_NAMES.has("blogPosts")).toBe(true)
    expect(TABLE_NAMES.has("menuItems")).toBe(true)
  })

  it("does not treat dialect-free constants as tables", () => {
    // These must stay importable from `@/db/schema/*`: they are not in the
    // derived schema, so the runtime facade does not carry them.
    for (const constant of ["SETTINGS_SINGLETON_ID", "ACTIVITY_RETENTION_DAYS", "REVISION_RETENTION", "MENU_ITEM_TYPES"]) {
      expect(TABLE_NAMES.has(constant), constant).toBe(false)
    }
  })

  it("finds source files to check", () => {
    expect(walk(SRC).length).toBeGreaterThan(100)
  })
})

describe("no runtime module builds queries from canonical SQLite tables", () => {
  it("has no violations", () => {
    const violations = scan()
    const readable = violations.map((v) => `${v.file} → ${v.names.join(", ")}`)
    expect(readable).toEqual([])
  })

  it("would catch a violation if one were introduced", () => {
    // Proves the scanner can fail. Without this, a broken regex would make the
    // assertion above pass forever — the exact failure mode that let the
    // original defect ship.
    const sample = `import { blogPosts } from "@/db/schema/blogPosts"`
    const found = [...sample.matchAll(SCHEMA_IMPORT)]
    expect(found).toHaveLength(1)
    expect(found[0][1].trim()).toBe("blogPosts")
    expect(TABLE_NAMES.has("blogPosts")).toBe(true)
  })

  it("does not flag a type-only import", () => {
    const sample = `import type { blogPosts } from "@/db/schema/blogPosts"`
    const stripped = sample.replace(TYPE_IMPORT, "")
    expect([...stripped.matchAll(SCHEMA_IMPORT)]).toHaveLength(0)
  })

  it("does not flag a constant import", () => {
    const sample = `import { SETTINGS_SINGLETON_ID } from "@/db/schema/settings"`
    const [match] = [...sample.matchAll(SCHEMA_IMPORT)]
    const offending = match[1]
      .split(",")
      .map((s) => s.trim())
      .filter((n) => TABLE_NAMES.has(n))
    expect(offending).toEqual([])
  })
})

describe("the Drizzle behaviour this architecture depends on", () => {
  /**
   * The premise, pinned.
   *
   * `drizzle-orm` is pinned to an exact version in package.json because two of
   * its behaviours are load-bearing here and neither is a documented public
   * API: `getTableConfig` (used by the derivation) and — the one that caused
   * the defect — the fact that a parameter's encoder comes from the COLUMN
   * OBJECT rather than from the executing database.
   *
   * If an upgrade changes either, this fails and says so, instead of the
   * application silently writing wrong data again.
   */
  it("takes a boolean's encoding from the column object, per dialect", async () => {
    const { getTableConfig: pg } = await import("drizzle-orm/pg-core")
    const { deriveSchema } = await import("@/db/deriveDialects")

    const sqliteColumn = getTableConfig(canonicalSchema.blogCategories).columns.find(
      (c) => c.name === "isIndexable",
    )!
    const derived = deriveSchema(canonicalSchema as unknown as Record<string, unknown>, "postgresql")
    const pgColumn = pg(derived.blogCategories as never).columns.find(
      (c) => c.name === "isIndexable",
    )!

    // SQLite stores booleans as integers; every other engine has a real type.
    expect(sqliteColumn.mapToDriverValue(true)).toBe(1)
    expect(sqliteColumn.mapToDriverValue(false)).toBe(0)
    expect(pgColumn.mapToDriverValue(true)).toBe(true)
    expect(pgColumn.mapToDriverValue(false)).toBe(false)

    // …which is exactly why the two must never be crossed: `1` is what
    // PostgreSQL stored as `false`.
    expect(sqliteColumn.mapToDriverValue(true)).not.toBe(pgColumn.mapToDriverValue(true))
  })

  it("is pinned to an exact drizzle-orm version", async () => {
    const { readFileSync } = await import("node:fs")
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      dependencies: Record<string, string>
    }
    const range = pkg.dependencies["drizzle-orm"]
    // No `^` or `~`: a minor bump must be a deliberate, reviewed change.
    expect(range, "drizzle-orm must be pinned exactly").toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe("the runtime facade covers the whole schema", () => {
  it("exports exactly the canonical tables, no more and no less", async () => {
    // A table missing from the facade is a table a developer will import from
    // `@/db/schema` because that is the only place it exists — reintroducing
    // the defect one table at a time.
    const facade = await import("@/db/tables")
    const exported = new Set(Object.keys(facade))
    expect([...TABLE_NAMES].filter((t) => !exported.has(t))).toEqual([])
    expect([...exported].filter((t) => !TABLE_NAMES.has(t))).toEqual([])
  })
})
