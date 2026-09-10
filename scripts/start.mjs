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
 * NODE_ENV DEFAULTS TO production BEFORE THE MIGRATOR RUNS, because `next start`
 * applies that default itself: the migrator has to read the same `.env.production*`
 * files the server is about to, or the two can mean different databases.
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

  console.log("FlowCMS: applying database migrations...")
  const migrated = await runChild(process.execPath, [MIGRATE], { env })
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
