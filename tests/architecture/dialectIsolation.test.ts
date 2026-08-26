import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * No module outside `src/db/` may know which database it is talking to.
 *
 * This is the load-bearing promise of Phase 5, and it is exactly the kind of
 * promise that decays: the next person who needs a returned row will reach for
 * `.returning()`, it will compile, the SQLite suite will pass, and MySQL will
 * break for somebody else weeks later.
 *
 * It compiles because it must. The application is typed against the SQLite
 * instance (see `src/db/createDatabase.ts` for why there is no alternative),
 * and `.returning()` and `onConflictDoUpdate` exist on that type while being
 * absent on MySQL. TypeScript cannot express "this method exists but only on
 * three of four engines", so this test is the enforcement instead.
 */

const SRC = fileURLToPath(new URL("../../src", import.meta.url))

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

function rel(file: string): string {
  return relative(SRC, file).split(sep).join("/")
}

/** Strip comments — prose explaining why something is forbidden is not a use
 *  of it, and a test that punished explanation would be answered by deleting
 *  the explanation. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

const files = walk(SRC)

/** The database layer is allowed — indeed required — to know the dialect. */
function isInfrastructure(path: string): boolean {
  return path.startsWith("db/") || path === "Framework/Config/databaseConfig.ts"
}

describe("dialect isolation", () => {
  it("finds the source tree", () => {
    expect(files.length).toBeGreaterThan(100)
  })

  const forbidden: Array<{ pattern: RegExp; what: string; instead: string }> = [
    {
      pattern: /\.returning\s*\(/,
      what: ".returning()",
      instead: "insertReturning / updateReturning / deleteReturning from @/db/writes",
    },
    {
      pattern: /onConflictDo(Update|Nothing)\s*\(/,
      what: "onConflictDoUpdate/onConflictDoNothing",
      instead: "upsert() from @/db/writes",
    },
    {
      pattern: /onDuplicateKeyUpdate\s*\(/,
      what: "onDuplicateKeyUpdate",
      instead: "upsert() from @/db/writes",
    },
    {
      pattern: /\b(sqliteTable|pgTable|mysqlTable)\s*\(/,
      what: "a dialect-specific table builder",
      instead: "src/db/schema (SQLite is canonical; the other dialects are derived)",
    },
    {
      pattern: /drizzle-orm\/(pg-core|mysql-core|postgres-js|mysql2)/,
      what: "a dialect-specific Drizzle import",
      instead: "the shared db handle from @/db/client",
    },
  ]

  for (const { pattern, what, instead } of forbidden) {
    it(`no module outside src/db uses ${what}`, () => {
      const offenders: string[] = []
      for (const file of files) {
        const path = rel(file)
        if (isInfrastructure(path)) continue
        // The schema files are the canonical SQLite definition and necessarily
        // use sqliteTable.
        if (path.startsWith("db/schema/")) continue
        const source = stripComments(readFileSync(file, "utf8"))
        if (pattern.test(source)) offenders.push(path)
      }
      expect(offenders, `use ${instead} instead`).toEqual([])
    })
  }

  it("reads the database environment from exactly one module", () => {
    const readers = files
      .filter((file) => {
        const source = readFileSync(file, "utf8")
        return /process\.env\.DATABASE_(URL|DIALECT|PATH)/.test(source)
      })
      .map(rel)
      .sort()

    // databaseConfig.ts parses; client.ts supplies process.env to it. Nothing
    // else may reach for the connection string.
    expect(readers).toEqual(["db/client.ts"])
  })

  it("has no DATABASE_PATH left anywhere — DATABASE_URL is the contract", () => {
    const offenders = files
      .filter((file) => /DATABASE_PATH/.test(stripComments(readFileSync(file, "utf8"))))
      .map(rel)
    expect(offenders).toEqual([])
  })
})
