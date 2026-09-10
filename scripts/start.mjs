#!/usr/bin/env node
/**
 * `npm start` — and every other manager's `run start`: migrate, then serve.
 *
 * The same two steps, in the same order and under the same fail-closed rule, as
 * `docker/entrypoint.sh`. The start script used to be bare `next start`, so
 * migrations ran only inside the Docker image; a buildpack deployment (which
 * runs this script and never the entrypoint) reported `migrations_pending`
 * forever against a database nothing had created.
 *
 * THE MIGRATE CHILD'S NODE_ENV IS ALIGNED TO next start's ENV-FILE RULE, not just
 * defaulted. `next start` always loads the production `.env*` files — or the
 * test files when NODE_ENV=test — no matter what else NODE_ENV says
 * (node_modules/next/dist/server/config.js calls `loadEnvConfig(dir, dev, …)`
 * with `dev` true only in `next dev`). Defaulting NODE_ENV only when it was
 * unset was not that rule: with NODE_ENV=development already set in the shell,
 * the migrator used to read `.env.development` and migrate that database while
 * `next start` went on to serve the production one, unmigrated. So the migrate
 * child's NODE_ENV is forced to match Next's rule — "test" stays "test",
 * anything else becomes "production" — regardless of what the shell set. The
 * Next child is untouched: it keeps receiving NODE_ENV defaulted to
 * "production" only when unset, exactly as before, because Next applies its
 * own env-file rule to whatever it receives.
 *
 * A failed migration exits here, with its code, and the server never starts.
 * Starting anyway only moves the failure to the first request, where it looks
 * like a missing table instead of a migration that failed.
 *
 * Next is invoked by path through node — see scripts/build.mjs for why.
 * Arguments pass through: `npm start -- -p 4000`.
 */

import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { runChild } from "./lib/runChild.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const MIGRATE = join(ROOT, "scripts", "migrate.mjs")
const NEXT_BIN = join(ROOT, "node_modules", "next", "dist", "bin", "next")

async function main() {
  const env = { ...process.env, NODE_ENV: process.env.NODE_ENV || "production" }
  // Next's own rule for which .env* files `next start` loads (see the doc
  // comment above): "test" stays "test", everything else becomes "production".
  const migrateEnv = { ...env, NODE_ENV: env.NODE_ENV === "test" ? "test" : "production" }

  console.log("FlowCMS: applying database migrations...")
  const migrated = await runChild(process.execPath, [MIGRATE], { env: migrateEnv })
  if (migrated !== 0) {
    console.error("FlowCMS: migrations failed, so the server was NOT started.")
    return migrated
  }

  console.log("FlowCMS: starting server...")
  return runChild(process.execPath, [NEXT_BIN, "start", ...process.argv.slice(2)], { env })
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`FlowCMS: startup failed: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  },
)
