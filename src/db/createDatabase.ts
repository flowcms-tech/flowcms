import { createClient } from "@libsql/client"
import type { LibSQLDatabase } from "drizzle-orm/libsql"
import { drizzle as drizzleSqlite } from "drizzle-orm/libsql"
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js"
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2"
import { sql } from "drizzle-orm"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { DatabaseConfig } from "@/Framework/Config/databaseConfig"
import * as sqliteSchema from "./schema"
import { deriveSchema } from "./deriveDialects"

/**
 * One database handle, four engines.
 *
 * THE TYPE BOUNDARY, STATED PLAINLY
 *
 * Drizzle's `BaseSQLiteDatabase`, `PgDatabase` and `MySqlDatabase` share no
 * supertype, and neither do their table objects. Something has to be the type
 * the application compiles against, so SQLite is canonical: it is the default
 * dialect, the one the unit suite runs on, and the one `src/db/schema/*.ts` is
 * written in.
 *
 * That costs exactly two casts, both below, and nothing in application code.
 * This was verified before the design was committed: a spike ran identical
 * query code through all three instances under `tsc --strict`, and a negative
 * control confirmed inference survives — assigning a `string` to a `number`,
 * reading a column that does not exist, and inserting a wrong-typed value all
 * still fail to compile, naming the real row type.
 *
 * WHAT THE BOUNDARY DOES NOT PROTECT
 *
 * `.returning()` and `.onConflictDoUpdate()` exist on the SQLite type and do
 * not exist on MySQL. Calls to them therefore COMPILE and would fail at
 * runtime on MySQL only. The type system cannot catch that, so a test does:
 * `tests/architecture/dialectIsolation.test.ts` forbids both outside
 * `src/db/`, and `src/db/writes.ts` provides portable replacements.
 *
 * This is the one place where "it compiles" is not sufficient evidence, and it
 * is documented here rather than discovered in production on MySQL.
 */

/**
 * The canonical application database type: the SQLite instance parameterised by
 * the real schema, so `db.query.<table>` and every inferred row type keep
 * working exactly as they did before Phase 5.
 */
export type AppDatabase = LibSQLDatabase<typeof sqliteSchema>
export type AppSchema = typeof sqliteSchema

export interface DatabaseHandle {
  db: AppDatabase
  schema: AppSchema
  dialect: DatabaseConfig["dialect"]
  /** Dialect-appropriate liveness check. Used by /api/ready. */
  ping: () => Promise<void>
  /** Does the migration bookkeeping table exist and hold at least one row? */
  migrationsApplied: () => Promise<boolean>
  close: () => Promise<void>
}

/** Drizzle's bookkeeping table, per dialect migrator. */
const MIGRATIONS_TABLE = {
  sqlite: "__drizzle_migrations",
  postgresql: "drizzle.__drizzle_migrations",
  mysql: "__drizzle_migrations",
} as const

function poolMax(): number {
  const raw = Number(process.env.DATABASE_POOL_MAX)
  // A small self-hosted deployment does not want a hundred connections, and a
  // per-request connection is worse. Ten is a working default for both; one
  // variable is enough tuning surface.
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10
}

export function createDatabase(config: DatabaseConfig): DatabaseHandle {
  switch (config.driverFamily) {
    case "sqlite": {
      // `file:` URL → path. libsql creates the database file but not the
      // directory above it, and `data/` is gitignored runtime state absent
      // from a fresh image and an empty volume.
      //
      // THIS DELIBERATELY THROWS. Phase 9.6 wrapped it in a catch to get a CI
      // job green; Phase 9.7 reverted that, because the failure it was hiding
      // was not the product's. `scripts/verify-create-flowcms.mjs` had been
      // generating a DOCKER-mode project — whose `DATABASE_URL` is the
      // container's `file:/data/app.db` — and building it on the host, so the
      // application was asked to use a path that only exists inside an image.
      // The verifier now builds a host topology on the host, and an unwritable
      // database directory is once again what it should be: loud, and fatal.
      const path = config.url.replace(/^file:/, "")
      mkdirSync(dirname(resolve(path)), { recursive: true })

      const client = createClient({ url: config.url })
      // Fire-and-forget is safe: the local driver runs statements in
      // submission order on one connection, so this lands before the first
      // query. The catch only prevents an unhandled rejection.
      void client.execute("PRAGMA foreign_keys = ON").catch(() => {})

      const db = drizzleSqlite(client, { schema: sqliteSchema })
      return {
        db,
        schema: sqliteSchema,
        dialect: config.dialect,
        ping: async () => {
          await client.execute("select 1")
        },
        migrationsApplied: async () => {
          const result = await client.execute(
            `select count(*) as n from ${MIGRATIONS_TABLE.sqlite}`,
          )
          return Number(result.rows[0]?.n ?? 0) > 0
        },
        close: async () => {
          client.close()
        },
      }
    }

    case "postgresql": {
      // Imported lazily so a SQLite deployment never loads the driver.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const postgres = require("postgres") as typeof import("postgres")
      const client = postgres(config.url, { max: poolMax(), onnotice: () => {} })
      const schema = deriveSchema(sqliteSchema as Record<string, unknown>, "postgresql")

      // Boundary cast #1 — see the note at the top of this file.
      const db = drizzlePg(client, { schema: schema as never }) as unknown as AppDatabase

      return {
        db,
        schema: schema as unknown as AppSchema,
        dialect: config.dialect,
        ping: async () => {
          await client`select 1`
        },
        migrationsApplied: async () => {
          const rows = await client`
            select count(*)::int as n from ${client.unsafe(MIGRATIONS_TABLE.postgresql)}
          `
          return Number(rows[0]?.n ?? 0) > 0
        },
        close: async () => {
          await client.end({ timeout: 5 })
        },
      }
    }

    case "mysql": {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mysql = require("mysql2/promise") as typeof import("mysql2/promise")
      const pool = mysql.createPool({
        uri: config.url,
        connectionLimit: poolMax(),
        // The application stores epoch millis in BIGINT and converts in the
        // custom column type; asking mysql2 for strings keeps large integers
        // exact rather than routing them through a float.
        supportBigNumbers: true,
        bigNumberStrings: true,
      })
      const schema = deriveSchema(sqliteSchema as Record<string, unknown>, "mysql")

      // Boundary cast #2 — see the note at the top of this file.
      const db = drizzleMysql(pool, {
        schema: schema as never,
        mode: "default",
      }) as unknown as AppDatabase

      return {
        db,
        schema: schema as unknown as AppSchema,
        dialect: config.dialect,
        ping: async () => {
          await pool.query("select 1")
        },
        migrationsApplied: async () => {
          const [rows] = await pool.query(
            `select count(*) as n from ${MIGRATIONS_TABLE.mysql}`,
          )
          const first = (rows as Array<{ n: number | string }>)[0]
          return Number(first?.n ?? 0) > 0
        },
        close: async () => {
          await pool.end()
        },
      }
    }
  }
}

/**
 * Wait for the database to accept a connection.
 *
 * Remote engines take time to initialise on first `docker compose up`, so a
 * migration that runs the instant the container starts will lose a race it
 * could simply have waited out. Bounded, because retrying forever turns a wrong
 * password into a container that looks busy rather than broken — and an
 * operator watching "starting" learns nothing.
 */
export async function waitForDatabase(
  handle: DatabaseHandle,
  options: { attempts?: number; baseDelayMs?: number; log?: (message: string) => void } = {},
): Promise<void> {
  const attempts = options.attempts ?? 10
  const base = options.baseDelayMs ?? 500
  const log = options.log ?? (() => {})

  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await handle.ping()
      return
    } catch (error) {
      lastError = error
      if (attempt === attempts) break
      const delay = Math.min(base * 2 ** (attempt - 1), 5_000)
      log(`database not ready (attempt ${attempt}/${attempts}), retrying in ${delay}ms`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`Database did not become ready after ${attempts} attempts: ${reason}`)
}

export { sql }
