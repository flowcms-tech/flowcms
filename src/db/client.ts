import {
  databaseUrlFor,
  parseDatabaseConfig,
  type DatabaseConfig,
} from "@/Framework/Config/databaseConfig"
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
 *
 * ONE HANDLE PER PROCESS, NOT ONE PER EVALUATION. `next dev` re-evaluates this
 * module after a save without restarting Node. As a plain module-scope
 * constant, every re-evaluation opened a new pool and orphaned the previous one
 * — up to DATABASE_POOL_MAX connections each, with nothing left that could
 * close them — until MySQL answered `ER_CON_COUNT_ERROR` (issue #18). The
 * handle now lives on `globalThis`, which survives re-evaluation, and is reused
 * while the dialect and URL it was built from are unchanged. A change (Next
 * reloads `.env` in place) builds a new handle and closes the old one, rather
 * than quietly keeping the previous database. The key carries the dialect
 * because MySQL and MariaDB share the `mysql:` scheme.
 *
 * Not restricted to development: a production process evaluates this module
 * once, so the cache is simply never consulted twice there.
 */
const config = parseDatabaseConfig({
  DATABASE_DIALECT: process.env.DATABASE_DIALECT,
  DATABASE_URL: databaseUrlFor(process.env),
})

const SHARED_HANDLE = Symbol.for("flowcms.db.handle")

type SharedHandle = { key: string; handle: DatabaseHandle }

function processWideHandle(config: DatabaseConfig): DatabaseHandle {
  const shared = globalThis as typeof globalThis & { [SHARED_HANDLE]?: SharedHandle }
  const key = `${config.dialect} ${config.url}`

  const existing = shared[SHARED_HANDLE]
  if (existing?.key === key) return existing.handle

  // Nothing else holds the replaced handle's pool any more. The catch only
  // prevents an unhandled rejection from a pool that is already gone.
  if (existing) void existing.handle.close().catch(() => {})

  const handle = createDatabase(config)
  shared[SHARED_HANDLE] = { key, handle }
  return handle
}

export const handle: DatabaseHandle = processWideHandle(config)

export const db = handle.db
export const databaseDialect = handle.dialect
