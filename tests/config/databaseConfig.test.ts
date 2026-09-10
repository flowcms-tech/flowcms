import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import * as nextConstants from "next/constants"
import { describe, expect, it } from "vitest"
import {
  DEVELOPMENT_DATABASE_URL,
  NEXT_BUILD_PHASE,
  databaseUrlFor,
  parseDatabaseConfig,
  redactDatabaseUrl,
  type DatabaseDialect,
} from "@/Framework/Config/databaseConfig"

/**
 * Database selection is the one configuration mistake that cannot be allowed to
 * resolve itself. A contradictory pair — `DATABASE_DIALECT=postgresql` with a
 * `file:` URL — has two plausible readings and no correct guess, and picking
 * one silently means an operator who believes they are running PostgreSQL is
 * running SQLite. So contradictions are errors, not inputs to a heuristic.
 *
 * MySQL and MariaDB share the `mysql://` scheme, which is exactly why the
 * dialect is explicit rather than sniffed from the server: the supported matrix
 * must not depend on a runtime guess about which product answered.
 */

const PG_URL = "postgresql://flowcms:hunter2@postgres:5432/flowcms"
const MYSQL_URL = "mysql://flowcms:hunter2@mysql:3306/flowcms"
const SQLITE_URL = "file:/data/app.db"

describe("parseDatabaseConfig — accepted combinations", () => {
  const valid: Array<[DatabaseDialect, string]> = [
    ["sqlite", SQLITE_URL],
    ["postgresql", PG_URL],
    ["mysql", MYSQL_URL],
    ["mariadb", MYSQL_URL],
  ]

  for (const [dialect, url] of valid) {
    it(`accepts ${dialect}`, () => {
      const config = parseDatabaseConfig({ DATABASE_DIALECT: dialect, DATABASE_URL: url })
      expect(config.dialect).toBe(dialect)
      expect(config.url).toBe(url)
    })
  }

  it("accepts postgres:// as well as postgresql://", () => {
    const config = parseDatabaseConfig({
      DATABASE_DIALECT: "postgresql",
      DATABASE_URL: "postgres://flowcms:hunter2@postgres:5432/flowcms",
    })
    expect(config.dialect).toBe("postgresql")
  })

  it("maps mariadb to the mysql driver family while keeping its own dialect", () => {
    // The driver is shared; the dialect is not. MariaDB is verified
    // independently, so it must remain distinguishable after parsing.
    const config = parseDatabaseConfig({ DATABASE_DIALECT: "mariadb", DATABASE_URL: MYSQL_URL })
    expect(config.dialect).toBe("mariadb")
    expect(config.driverFamily).toBe("mysql")
  })

  it("defaults to sqlite when the dialect is unset and the URL is a file", () => {
    const config = parseDatabaseConfig({ DATABASE_URL: SQLITE_URL })
    expect(config.dialect).toBe("sqlite")
  })
})

describe("parseDatabaseConfig — rejected combinations", () => {
  it("rejects a dialect that contradicts the URL scheme", () => {
    const contradictions: Array<[string, string]> = [
      ["postgresql", SQLITE_URL],
      ["sqlite", PG_URL],
      ["mysql", PG_URL],
      ["postgresql", MYSQL_URL],
      ["mariadb", SQLITE_URL],
    ]
    for (const [dialect, url] of contradictions) {
      expect(
        () => parseDatabaseConfig({ DATABASE_DIALECT: dialect, DATABASE_URL: url }),
        `${dialect} + ${url}`,
      ).toThrow()
    }
  })

  it("rejects an unknown dialect", () => {
    for (const dialect of ["oracle", "mssql", "postgres-ish", ""]) {
      expect(() =>
        parseDatabaseConfig({ DATABASE_DIALECT: dialect, DATABASE_URL: PG_URL }),
      ).toThrow()
    }
  })

  it("rejects a missing URL", () => {
    expect(() => parseDatabaseConfig({ DATABASE_DIALECT: "sqlite" })).toThrow()
    expect(() => parseDatabaseConfig({ DATABASE_DIALECT: "sqlite", DATABASE_URL: "  " })).toThrow()
  })

  it("refuses to guess when the dialect is unset and the URL is remote", () => {
    // A mysql:// URL could be MySQL or MariaDB. Defaulting either way would
    // silently pick a product the operator did not choose.
    expect(() => parseDatabaseConfig({ DATABASE_URL: MYSQL_URL })).toThrow(/DATABASE_DIALECT/)
  })

  it("names the variable and the reason", () => {
    try {
      parseDatabaseConfig({ DATABASE_DIALECT: "postgresql", DATABASE_URL: SQLITE_URL })
      throw new Error("expected a rejection")
    } catch (error) {
      const message = (error as Error).message
      expect(message).toMatch(/DATABASE_DIALECT/)
      expect(message).toMatch(/postgresql/)
    }
  })
})

describe("credential redaction", () => {
  it("removes the password from a URL", () => {
    const redacted = redactDatabaseUrl(PG_URL)
    expect(redacted).not.toContain("hunter2")
    expect(redacted).toContain("postgres:5432")
    expect(redacted).toContain("flowcms")
  })

  it("redacts mysql URLs too", () => {
    expect(redactDatabaseUrl(MYSQL_URL)).not.toContain("hunter2")
  })

  it("leaves a file URL alone — there is no credential in it", () => {
    expect(redactDatabaseUrl(SQLITE_URL)).toBe(SQLITE_URL)
  })

  it("never throws on unparseable input, and never echoes it verbatim", () => {
    // A malformed URL still reaches error paths, and must not become a
    // second way to leak whatever the operator actually typed.
    expect(() => redactDatabaseUrl("not a url at all")).not.toThrow()
    expect(redactDatabaseUrl("postgresql://user:secret@")).not.toContain("secret")
  })

  it("keeps the password out of the thrown validation error", () => {
    try {
      parseDatabaseConfig({ DATABASE_DIALECT: "sqlite", DATABASE_URL: PG_URL })
      throw new Error("expected a rejection")
    } catch (error) {
      expect((error as Error).message).not.toContain("hunter2")
    }
  })
})

/**
 * WHERE THE URL COMES FROM — and the one place it must not come from.
 *
 * With DATABASE_URL unset the client used to open `file:data/app.db`. In a
 * production container that file sits in the writable layer and is deleted, with
 * every post, setting and account, on the next redeploy — while the site looked
 * healthy. A production report found exactly that: a 0-byte app.db, and an
 * operator who believed the site was on MySQL.
 *
 * The default survives where it is harmless: development, tests, and `next
 * build`, which runs with NODE_ENV=production and evaluates the client to collect
 * page data, with no database configured in either the Docker builder stage or
 * CI.
 */
describe("databaseUrlFor", () => {
  it.each([undefined, "development", "test", "production"])(
    "uses DATABASE_URL whenever it is set (NODE_ENV=%s)",
    (NODE_ENV) => {
      expect(databaseUrlFor({ DATABASE_URL: PG_URL, NODE_ENV })).toBe(PG_URL)
    },
  )

  it.each([undefined, "development", "test"])("defaults to SQLite for NODE_ENV=%s", (NODE_ENV) => {
    expect(databaseUrlFor({ NODE_ENV })).toBe(DEVELOPMENT_DATABASE_URL)
  })

  it("defaults during next build, which has no database of its own", () => {
    expect(databaseUrlFor({ NODE_ENV: "production", NEXT_PHASE: NEXT_BUILD_PHASE })).toBe(DEVELOPMENT_DATABASE_URL)
  })

  it("refuses to default while serving production", () => {
    expect(() => databaseUrlFor({ NODE_ENV: "production" })).toThrow(/DATABASE_URL is required in production/)
  })

  it("refuses in production at runtime phases too", () => {
    expect(() => databaseUrlFor({ NODE_ENV: "production", NEXT_PHASE: "phase-production-server" })).toThrow(
      /DATABASE_URL is required in production/,
    )
  })

  it("treats a blank DATABASE_URL as unset", () => {
    expect(() => databaseUrlFor({ NODE_ENV: "production", DATABASE_URL: "   " })).toThrow(
      /DATABASE_URL is required in production/,
    )
  })

  it("names the phase Next actually sets during a build", () => {
    expect(NEXT_BUILD_PHASE).toBe(nextConstants.PHASE_PRODUCTION_BUILD)
  })
})

describe("the database client has no default of its own", () => {
  const ROOT = fileURLToPath(new URL("../..", import.meta.url))
  const client = readFileSync(join(ROOT, "src/db/client.ts"), "utf8")

  it("takes its URL from databaseUrlFor", () => {
    expect(client).toContain("databaseUrlFor(process.env)")
  })

  it("supplies no inline fallback", () => {
    expect(client).not.toMatch(/DATABASE_URL\s*\?\?/)
  })
})
