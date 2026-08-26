import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Environment for the first-run setup suites, in its own module so it is
 * evaluated BEFORE `@/db/client`.
 *
 * `@/db/client` reads DATABASE_URL once, at module load, and ES imports are
 * evaluated before any statement in the importing file — so setting the
 * variable inside the test would be too late and would point the suite at
 * whatever database the developer happens to have configured.
 *
 * SQLite in a temp file by default, so `bun run test` needs no servers. Supply
 * an override to run the identical suite against a real engine, which is how
 * the completion transaction and the concurrent-setup race are covered on
 * PostgreSQL, MySQL and MariaDB:
 *
 *   TEST_SETUP_DIALECT=postgresql \
 *   TEST_SETUP_URL=postgresql://… npx vitest run --no-file-parallelism tests/setup
 *
 * `--no-file-parallelism` IS REQUIRED FOR A REMOTE ENGINE, and is why the
 * default is not. Under SQLite each file gets its own temp database from the
 * `mkdtempSync` below, so files are genuinely isolated and run in parallel. A
 * remote engine is ONE database shared by every file, and these suites each
 * reset the settings singleton and the user table to model a fresh install —
 * so run in parallel they delete each other's rows mid-test and fail in ways
 * that look like engine bugs and are not.
 *
 * MariaDB is run separately from MySQL. It shares a driver and the migration
 * SQL and is still a different product.
 */

const override = process.env.TEST_SETUP_URL

export const DB_DIALECT = override ? (process.env.TEST_SETUP_DIALECT ?? "postgresql") : "sqlite"

export const DB_URL =
  override ?? `file:${join(mkdtempSync(join(tmpdir(), "flowcms-setup-")), "setup.db")}`

process.env.DATABASE_DIALECT = DB_DIALECT
process.env.DATABASE_URL = DB_URL

/** Migration folder for whichever engine this run is pointed at. */
export const MIGRATIONS_FOLDER =
  DB_DIALECT === "postgresql"
    ? "src/db/migrations/postgresql"
    : DB_DIALECT === "sqlite"
      ? "src/db/migrations/sqlite"
      : "src/db/migrations/mysql"
