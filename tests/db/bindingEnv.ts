import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Environment for the application-binding contract, in its own module so it is
 * evaluated BEFORE `@/db/client`.
 *
 * `@/db/client` reads DATABASE_URL once, at module load, and ES imports are
 * evaluated before any statement in the importing file — so setting the
 * variable inside the test would be too late and would point the suite at
 * whatever database the developer happens to have configured.
 *
 * SQLite in a temp file by default, so `bun run test` needs no servers. Supply
 * an override to run the identical suite against a real engine:
 *
 *   TEST_BINDING_DIALECT=postgresql \
 *   TEST_BINDING_URL=postgresql://… bun run test tests/db/applicationBinding.test.ts
 */

const override = process.env.TEST_BINDING_URL

export const BINDING_DIALECT = override
  ? (process.env.TEST_BINDING_DIALECT ?? "postgresql")
  : "sqlite"

export const BINDING_URL =
  override ?? `file:${join(mkdtempSync(join(tmpdir(), "flowcms-binding-")), "binding.db")}`

process.env.DATABASE_DIALECT = BINDING_DIALECT
process.env.DATABASE_URL = BINDING_URL
