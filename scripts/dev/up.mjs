#!/usr/bin/env node
/**
 * `npm run dev:docker` — the everyday Core development command.
 *
 * Prepares the local environment, then starts the bind-mounted development
 * stack attached to this terminal. Safe to run repeatedly: it generates only
 * what is missing, it never touches the database, and it never resets anything.
 * `npm run dev:reset` is the only command that returns the installation to its
 * uninitialized state.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not create an owner. `scripts/bootstrap-owner.mjs` is never called
 * from here and nothing seeds an account, because the point of this environment
 * is to walk the real first-run flow in a browser: site information, owner
 * information, the setup token, then a real login. An environment that arrived
 * already initialized could not test the thing it exists to test.
 *
 * It does not put the setup token anywhere near the browser. The token is
 * printed to this terminal and nowhere else — not pre-filled into the form, not
 * rendered into the page, not exposed by an endpoint. `/setup` demands it
 * exactly as it would on a production install.
 */

import {
  ensureLocalEnvironment,
  resolveUnmanaged,
  validateSecrets,
  LOCAL_ENV_FILENAME,
} from "./localEnv.mjs"
import { requireDocker, runCompose } from "./compose.mjs"
import { resolveBundler } from "./bundler.mjs"

/**
 * `--build` forces an image rebuild; without it Compose builds only when the
 * image is missing, which is what makes the everyday command fast.
 *
 * Exposed as `dev:docker:build` rather than made the default. A rebuild is a
 * minutes-long `npm ci` plus a Next build, and source changes do not need one:
 * the repository is bind-mounted, so a rebuild is only ever about dependencies,
 * the Dockerfile, or the lockfile.
 */
const REBUILD = process.argv.includes("--build")

/** `--` separated passthrough, so `npm run dev:docker -- --profile redis` works. */
const EXTRA = process.argv.slice(2).filter((arg) => arg !== "--build")

const line = (label, value) => `  ${label.padEnd(13)}${value}`

function printBanner(values, generated, sources) {
  // Resolved through the same layers Compose will use, not read straight from
  // the shell: a developer with FLOWCMS_PORT=8080 in their `.env` must not be
  // sent to :3000 by the banner.
  const port = resolveUnmanaged("FLOWCMS_PORT", "3000")
  const adminPath = resolveUnmanaged("FLOWCMS_ADMIN_PATH", "/admin")
  const base = `http://localhost:${port}`

  console.log("")
  console.log("FlowCMS — local Core development")
  console.log("")
  console.log(line("Site", base))
  console.log(line("First run", `${base}/setup`))
  console.log(line("Admin", `${base}${adminPath}`))
  console.log("")
  // THE SETUP TOKEN, in the developer's own terminal. Requirement and
  // deliberate: the `/setup` form asks for it, nothing pre-fills it, and a
  // developer who cannot find it cannot test the flow. It is a local value on a
  // local machine; it is not a production credential and never becomes one.
  console.log(line("Setup token", values.FLOWCMS_SETUP_TOKEN))
  console.log("")
  console.log(`  Paste that into the Setup authorization field at ${base}/setup.`)
  console.log(`  It is stored in ${LOCAL_ENV_FILENAME} (gitignored) and survives dev:reset.`)

  if (generated.length > 0) {
    console.log("")
    console.log(`  Generated ${generated.length} local value(s): ${generated.join(", ")}`)
  }
  const reused = Object.entries(sources).filter(([, source]) => source === ".env")
  if (reused.length > 0) {
    console.log(`  Reused from .env: ${reused.map(([key]) => key).join(", ")}`)
  }
  console.log("")
}

async function main() {
  await requireDocker()

  const { values, sources, generated } = ensureLocalEnvironment()

  const problems = validateSecrets({ values, sources })
  if (problems.length > 0) {
    // A value that came from the developer's own `.env` is refused, not
    // replaced. Silently overriding a file somebody edited on purpose turns a
    // fixable configuration error into a mystery about which value is live.
    console.error("\nFlowCMS dev: the local environment has unusable secrets.\n")
    for (const problem of problems) {
      console.error(`  ${problem.key} (from ${problem.source}): ${problem.reason}`)
    }
    console.error(
      "\nThese are the application's own rules, not a development variant —\n" +
        "Framework/Config/deploymentSecret.ts enforces the same ones in production.\n" +
        `Remove the line from .env and one will be generated into ${LOCAL_ENV_FILENAME}.\n`,
    )
    process.exit(1)
  }

  const { bundler, reason } = resolveBundler(process.platform, process.env.FLOWCMS_DEV_BUNDLER)
  if (bundler !== "") values.FLOWCMS_DEV_BUNDLER = bundler

  printBanner(values, generated, sources)
  console.log(`  Bundler:     ${bundler || "turbopack"} (${reason})`)
  console.log("")

  const args = ["up", ...(REBUILD ? ["--build"] : []), ...EXTRA]
  console.log(`$ docker compose -f compose.yml -f compose.dev.yml ${args.join(" ")}\n`)

  // Attached, not detached: hot-reload output and compilation errors are the
  // reason to run this in a terminal at all. Ctrl-C stops the stack.
  process.exit(await runCompose(args, values))
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}\n`)
  process.exit(1)
})
