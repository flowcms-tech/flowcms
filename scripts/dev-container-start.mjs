#!/usr/bin/env node
/**
 * THE DEVELOPMENT CONTAINER'S ENTRYPOINT: migrate, then start Next in dev mode.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * `Dockerfile` declares `ENTRYPOINT ["./docker/entrypoint.sh"]` in the `runner`
 * stage and only there. `compose.dev.yml` builds `target: builder`, which is an
 * earlier stage — so the development container inherits the *node base image's*
 * `docker-entrypoint.sh` and never runs FlowCMS's. The migration step that
 * production performs before binding a port simply did not happen in
 * development, and a fresh `flowcms-data` volume therefore started Next against
 * an empty database. The symptom was `SQLITE_ERROR: no such table: settings` on
 * the first request, three layers away from the cause.
 *
 * This is the development half of `docker/entrypoint.sh`, and it upholds the
 * same contract that file states: a failed migration must abort here rather
 * than hand a server a schema that does not match the code.
 *
 * WHY NODE AND NOT A SHELL SCRIPT
 *
 * `docker/entrypoint.sh` is COPYed into the image and `chmod +x`-ed by the
 * Dockerfile. This one is not: it is reached through the repository bind mount,
 * so its mode and its line endings are whatever the developer's host filesystem
 * says. On Windows that is a coin flip, and a CRLF `#!/bin/sh` is the exact
 * failure `.gitattributes` exists to prevent — the kernel looks for `/bin/sh\r`
 * and the container exits claiming a path that obviously exists does not.
 * `node <file>` needs neither an executable bit nor an interpreter line.
 *
 * WHY IT INVOKES NEXT DIRECTLY RATHER THAN `npm run dev`
 *
 * The same rule CONTRIBUTING.md states for root scripts: nothing that the image
 * runs may assume which package manager is installed. `node node_modules/next/…`
 * is the same work with no such assumption, and it mirrors how the Dockerfile
 * invokes `next build`. `tests/dev/devWorkflow.test.ts` pins the arguments below
 * to the root `dev` script so the two cannot drift.
 *
 * SIGNALS. Node has no `exec`, so this process outlives its child and has to
 * forward termination itself. Without that, `docker compose down` waits out the
 * full 10-second kill timeout on every stop.
 */

import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * The migrator, spelled the same way `docker/entrypoint.sh` spells it.
 *
 * A literal POSIX path rather than `path.join`: this file only ever executes
 * inside the Linux development container, and the two startup paths naming the
 * migrator identically is what `tests/dev/devWorkflow.test.ts` checks.
 */
const MIGRATE_SCRIPT = "scripts/migrate.mjs"

/**
 * The development server command, as argv.
 *
 * Kept identical to the root `dev` script (`next dev -H 0.0.0.0`). The host
 * binding is not optional in a container: Next binds loopback by default, and a
 * server listening on 127.0.0.1 inside a container is unreachable from the
 * published port.
 */
const NEXT_ARGS = ["node_modules/next/dist/bin/next", "dev", "-H", "0.0.0.0"]

/**
 * Which bundler runs the dev server.
 *
 * DEFAULT IS NEXT'S OWN DEFAULT — Turbopack — and that is the one a developer
 * should normally use, because it is what `npm run dev` uses natively and what
 * the project is built against.
 *
 * `webpack` exists for one specific, measured reason: **Turbopack's watcher
 * does not see changes to a bind-mounted source tree from a Windows host.**
 * Neither its event-driven mode (no inotify events cross the mount) nor its
 * polling mode (`watchOptions.pollIntervalMs`, which does reach it — Next
 * passes it straight into Turbopack's `watch` options) detects an edit. Both
 * were verified directly: the container's own `grep` finds the new text while
 * the dev server keeps serving the old markup, with no error to explain it.
 * Webpack's `WATCHPACK_POLLING` watcher is older and does work there.
 *
 * Set `FLOWCMS_DEV_BUNDLER=webpack` when hot reload matters more than matching
 * the default bundler. Compilation semantics differ slightly between the two,
 * so this is a deliberate choice, not something the tooling picks for you.
 */
const BUNDLER = (process.env.FLOWCMS_DEV_BUNDLER ?? "").trim().toLowerCase()

/** Run a Node script to completion, inheriting stdio. Resolves to its exit code. */
function run(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: "inherit" })
    child.on("error", reject)
    child.on("exit", (code, signal) => resolvePromise(signal ? 1 : (code ?? 1)))
  })
}

async function main() {
  console.log("FlowCMS dev: applying database migrations...")

  const migration = await run([MIGRATE_SCRIPT])
  if (migration !== 0) {
    // Loud and specific. The whole point of this file is that the alternative —
    // starting anyway — produces a runtime error that names a missing table
    // rather than a migration that failed.
    console.error(
      "\nFlowCMS dev: migration failed, so the development server was NOT started.\n" +
        "Starting Next against an unmigrated database only moves this failure to\n" +
        "the first request, where it looks like a missing table instead.\n",
    )
    process.exit(migration)
  }

  const args = BUNDLER === "webpack" ? [...NEXT_ARGS, "--webpack"] : NEXT_ARGS

  console.log(
    `FlowCMS dev: starting Next in development mode` +
      `${BUNDLER === "webpack" ? " (webpack, for bind-mount hot reload)" : ""}...\n`,
  )

  const server = spawn(process.execPath, args, { cwd: ROOT, stdio: "inherit" })

  // Forward the signals Docker actually sends, then let the child's own exit
  // drive ours — killing this process first would orphan Next inside the
  // container.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      if (!server.killed) server.kill(signal)
    })
  }

  server.on("error", (error) => {
    console.error("FlowCMS dev: could not start the development server:", error.message)
    process.exit(1)
  })
  server.on("exit", (code, signal) => {
    process.exit(signal ? 0 : (code ?? 0))
  })
}

main().catch((error) => {
  console.error("FlowCMS dev: startup failed:", error instanceof Error ? error.message : error)
  process.exit(1)
})
