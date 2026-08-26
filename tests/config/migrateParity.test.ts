import { describe, expect, it } from "vitest"
import { parseDatabaseConfig } from "@/Framework/Config/databaseConfig"
// The migration runner is plain ESM so it can run under Node in the container,
// where there is no TypeScript loader. That means it carries its own copy of
// the dialect/URL rules.
import { resolveConfig, redactDatabaseUrl as redactMjs } from "../../scripts/migrate.mjs"
import { redactDatabaseUrl } from "@/Framework/Config/databaseConfig"

/**
 * Two implementations of one contract, pinned together.
 *
 * Duplication is the price of the migration runner being loader-free; drift is
 * not. If the two ever disagree, the failure mode is nasty and quiet: the
 * application refuses a configuration the migrator accepted, or worse, the
 * migrator writes a schema into a database the application then declines to
 * open. This test runs identical inputs through both and demands identical
 * verdicts.
 */

const CASES: Array<{ DATABASE_DIALECT?: string; DATABASE_URL?: string }> = [
  { DATABASE_DIALECT: "sqlite", DATABASE_URL: "file:/data/app.db" },
  { DATABASE_DIALECT: "postgresql", DATABASE_URL: "postgresql://u:p@h:5432/d" },
  { DATABASE_DIALECT: "postgresql", DATABASE_URL: "postgres://u:p@h:5432/d" },
  { DATABASE_DIALECT: "mysql", DATABASE_URL: "mysql://u:p@h:3306/d" },
  { DATABASE_DIALECT: "mariadb", DATABASE_URL: "mysql://u:p@h:3306/d" },
  { DATABASE_URL: "file:/data/app.db" },
  // Rejections
  { DATABASE_DIALECT: "postgresql", DATABASE_URL: "file:/data/app.db" },
  { DATABASE_DIALECT: "sqlite", DATABASE_URL: "postgresql://u:p@h/d" },
  { DATABASE_DIALECT: "oracle", DATABASE_URL: "postgresql://u:p@h/d" },
  { DATABASE_URL: "mysql://u:p@h:3306/d" },
  { DATABASE_DIALECT: "sqlite" },
  { DATABASE_URL: "" },
]

describe("migrate.mjs agrees with databaseConfig.ts", () => {
  for (const env of CASES) {
    const label = `${env.DATABASE_DIALECT ?? "(unset)"} + ${env.DATABASE_URL ?? "(unset)"}`

    it(`same verdict for ${label}`, () => {
      let tsResult: { ok: true; dialect: string; family: string } | { ok: false }
      try {
        const parsed = parseDatabaseConfig(env)
        tsResult = { ok: true, dialect: parsed.dialect, family: parsed.driverFamily }
      } catch {
        tsResult = { ok: false }
      }

      let mjsResult: { ok: true; dialect: string; family: string } | { ok: false }
      try {
        const parsed = resolveConfig(env) as { dialect: string; driverFamily: string }
        mjsResult = { ok: true, dialect: parsed.dialect, family: parsed.driverFamily }
      } catch {
        mjsResult = { ok: false }
      }

      expect(mjsResult).toEqual(tsResult)
    })
  }

  it("redacts identically", () => {
    for (const url of [
      "postgresql://user:hunter2@host:5432/db",
      "mysql://user:hunter2@host:3306/db",
      "file:/data/app.db",
      "not a url",
      "",
    ]) {
      expect(redactMjs(url), url).toBe(redactDatabaseUrl(url))
    }
  })
})
