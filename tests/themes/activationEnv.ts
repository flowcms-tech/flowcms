import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Environment for the activation suites, in its own module so it is evaluated
 * BEFORE `@/db/client`.
 *
 * `@/db/client` reads DATABASE_URL once, at module load, and ES imports are
 * evaluated before any statement in the importing file — so setting the
 * variable inside the test file would be too late and would point the suite at
 * whatever database the developer happens to have configured. `vi.hoisted` runs
 * early enough but before `node:fs` is initialised, so it cannot create a temp
 * directory either.
 *
 * Module evaluation follows import order, so importing this first is both
 * sufficient and deterministic.
 *
 * SQLite in a temp file by default, so `bun run test` needs no servers. Supply
 * an override to run the identical suite against a real engine — which is how
 * activation and the activity-log write are covered on PostgreSQL, MySQL and
 * MariaDB:
 *
 *   TEST_ACTIVATION_DIALECT=postgresql \
 *   TEST_ACTIVATION_URL=postgresql://… bun run test tests/appearance
 */

const override = process.env.TEST_ACTIVATION_URL

export const DB_DIALECT = override ? (process.env.TEST_ACTIVATION_DIALECT ?? "postgresql") : "sqlite"

export const DB_URL =
  override ?? `file:${join(mkdtempSync(join(tmpdir(), "flowcms-activation-")), "activation.db")}`

process.env.DATABASE_DIALECT = DB_DIALECT
process.env.DATABASE_URL = DB_URL

/** Registers the integration theme, so there is a second genuinely selectable
 *  theme for the write path to accept. Read once, at registry construction. */
process.env.FLOWCMS_INTEGRATION_THEMES = "1"
