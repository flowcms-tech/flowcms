import { databaseUrlFor, parseDatabaseConfig } from "@/Framework/Config/databaseConfig"
import { createDatabase, type DatabaseHandle } from "./createDatabase"

/**
 * The application's database handle.
 *
 * Every module keeps importing `db` exactly as before — the multi-dialect work
 * of Phase 5 is deliberately invisible here. Which engine answers is decided by
 * `DATABASE_DIALECT` and `DATABASE_URL` at startup and never leaks upward;
 * `tests/architecture/dialectIsolation.test.ts` enforces that no module outside
 * `src/db/` can tell.
 *
 * Constructed synchronously at module load, which is a constraint rather than a
 * preference: `auth.ts` calls `DrizzleAdapter(db, …)` at module scope, and the
 * adapter detects the dialect by walking the prototype chain. A lazy Proxy was
 * tried in an earlier phase and is a dead end — it either connects at import
 * anyway, buying nothing, or reports a plain object and fails with "Unsupported
 * database type (object) in Auth.js Drizzle adapter."
 *
 * All three drivers connect lazily, so constructing a handle opens no socket.
 * Waiting for a remote database to accept connections is the migration
 * runner's job (`waitForDatabase`), not this module's.
 *
 * DATABASE_PATH is gone. `DATABASE_URL=file:./data/app.db` is the SQLite form.
 *
 * NO SILENT DEFAULT IN PRODUCTION. With DATABASE_URL unset this used to open
 * `file:data/app.db` everywhere — in a production container, a file in the
 * writable layer that disappears with the site's content on the next redeploy.
 * `databaseUrlFor` keeps that default for development and for `next build`, and
 * refuses it while serving. `process.env` is passed whole, not read property by
 * property, so the bundler cannot inline NODE_ENV at build time.
 */
const config = parseDatabaseConfig({
  DATABASE_DIALECT: process.env.DATABASE_DIALECT,
  DATABASE_URL: databaseUrlFor(process.env),
})

export const handle: DatabaseHandle = createDatabase(config)

export const db = handle.db
export const databaseDialect = handle.dialect
