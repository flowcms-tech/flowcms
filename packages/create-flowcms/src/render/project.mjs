import { readFileSync, writeFileSync, rmSync, existsSync, chmodSync } from "node:fs"
import { join } from "node:path"
import { buildEnvFile } from "./envFile.mjs"
import { buildReadme } from "./readme.mjs"
import { buildProjectMarker } from "./marker.mjs"
import { renderDockerfile } from "./dockerfile.mjs"
import { overlaysToRemove } from "./compose.mjs"
import { writeJson } from "../scaffold.mjs"

/**
 * Applying a validated configuration to a copied template.
 *
 * THE APPLICATION SOURCE IS NEVER TOUCHED. Everything here writes one of five
 * things — `.env`, the Dockerfile's package-manager region, `README.md`,
 * `.flowcms/project.json`, `package.json` — or deletes a Compose overlay that
 * was not chosen. Nothing performs a string replacement across the tree, and
 * nothing rewrites a `.tsx` file. A scaffolder that edits application source is
 * a scaffolder whose output diverges from what anybody tested.
 *
 * Every function takes a VALIDATED config. There are no defensive branches for
 * bad input because bad input cannot arrive: `validateConfig` ran before a
 * single file was written.
 */

export function applyConfiguration(destination, config, { templateVersion, cliVersion }) {
  writeEnvFile(destination, config)
  writeReadme(destination, config)
  writeMarker(destination, config, { templateVersion, cliVersion })
  writePackageManagerFields(destination, config)
  writePnpmSettings(destination, config)
  configureDockerfile(destination, config)
  pruneComposeFiles(destination, config)
}

/**
 * `.env`, with the real secrets, restricted where the platform allows it.
 *
 * The permissions are BEST EFFORT and deliberately not fatal. POSIX modes do not
 * mean the same thing on Windows, and failing project creation over a
 * permission bit would be trading a real outcome for a cosmetic one. On Linux
 * and macOS it becomes owner-only, which is what matters on a shared machine.
 */
export function writeEnvFile(destination, config) {
  const path = join(destination, ".env")
  writeFileSync(path, buildEnvFile(config))
  try {
    chmodSync(path, 0o600)
  } catch {
    // Windows, an exotic filesystem, a container without the capability. The
    // file is written either way, and `.gitignore` is what keeps it out of a
    // repository.
  }
}

export function writeReadme(destination, config) {
  writeFileSync(join(destination, "README.md"), buildReadme(config))
}

export function writeMarker(destination, config, versions) {
  // `buildProjectMarker` refuses to return a marker containing a secret, so a
  // future field that accidentally carried one fails here rather than being
  // committed by the operator on their first push.
  writeJson(join(destination, ".flowcms", "project.json"), buildProjectMarker(config, versions))
}

/**
 * Managers the `packageManager` field is meaningful for.
 *
 * The field exists FOR COREPACK, and corepack manages exactly three package
 * managers. It does not know bun, and it does not ignore what it does not
 * know: a project whose manifest says `bun@1.3.14` makes every corepack shim in
 * it fail with `Unsupported package manager "bun"` — which is `npm`, `pnpm` and
 * `yarn` on any machine where the operator has ever run `corepack enable`,
 * globally, for some other project. Bun itself does not read the field, so
 * writing it buys nothing and costs that.
 *
 * The choice is not lost by omitting it: `.flowcms/project.json` records the
 * package manager for every project, bun included.
 */
const COREPACK_MANAGED = new Set(["npm", "pnpm", "yarn"])

/**
 * The generated `package.json`'s `packageManager` field.
 *
 * Written only when the version is KNOWN. Phase 7.3 omitted the field because
 * the manager was not chosen; now it is, but a version still has to be observed
 * rather than assumed — corepack reads this field and will refuse to run a
 * version that does not exist, so an invented one turns every command in the
 * project into an error. No version, no field: omission is honest, a wrong
 * value is not.
 */
export function writePackageManagerFields(destination, config) {
  if (!config.packageManagerVersion) return
  if (!COREPACK_MANAGED.has(config.packageManager)) return

  const path = join(destination, "package.json")
  const manifest = JSON.parse(readFileSync(path, "utf8"))
  manifest.packageManager = `${config.packageManager}@${config.packageManagerVersion}`
  writeJson(path, manifest)
}

/**
 * Dependencies whose install scripts pnpm must be told to run.
 *
 * Both compile or download a native binary, and both are reached from the
 * application's own dependency graph rather than chosen here:
 *
 *   sharp          Next's image optimiser
 *   unrs-resolver  the resolver behind eslint-config-next
 *
 * THIS LIST IS AN ALLOWLIST AND MUST STAY ONE. pnpm's blanket escape hatches
 * exist and are not used: a project that runs every dependency's install
 * scripts has given an arbitrary transitive package a shell on the operator's
 * machine at install time. Two named packages is the whole exposure.
 */
const PNPM_ALLOWED_BUILDS = ["sharp", "unrs-resolver"]

/**
 * `pnpm-workspace.yaml`, written for pnpm and nobody else.
 *
 * WHY THIS FILE EXISTS. pnpm 10+ refuses to run a dependency's install scripts
 * until they are approved, and **exits non-zero rather than skipping them
 * quietly** — so `pnpm install` fails outright on a freshly generated project
 * with `ERR_PNPM_IGNORED_BUILDS`. Without this file the first thing a pnpm
 * operator meets is a failed install.
 *
 * WHY `allowBuilds` AND NOT `onlyBuiltDependencies`. The setting was renamed
 * and reshaped: pnpm 9/10 took a LIST called `onlyBuiltDependencies`, pnpm 11
 * takes a MAP called `allowBuilds`. Phase 8 final verification tried the old
 * name in both `package.json` and this file and neither suppressed the error —
 * the name was wrong, not the location. Verified against pnpm 11.23.0, which
 * writes exactly this shape itself when `pnpm approve-builds` is run.
 *
 * Written only for pnpm because it is meaningless to the other three, and this
 * project already refuses to write fields that buy nothing (see COREPACK_MANAGED).
 */
export function writePnpmSettings(destination, config) {
  if (config.packageManager !== "pnpm") return

  const body =
    "# Generated by create-flowcms.\n" +
    "#\n" +
    "# pnpm does not run a dependency's install scripts unless it is told to,\n" +
    "# and fails the install rather than skipping them. These two compile or\n" +
    "# fetch a native binary and are required for `next build` and `next lint`.\n" +
    "#\n" +
    "# Keep this an allowlist. Adding a blanket allow-all here would give every\n" +
    "# transitive dependency a shell at install time.\n" +
    "allowBuilds:\n" +
    PNPM_ALLOWED_BUILDS.map((name) => `  ${name}: true\n`).join("")

  writeFileSync(join(destination, "pnpm-workspace.yaml"), body, "utf8")
}

/** Rewrite the Dockerfile's package-manager region, in Docker mode only. */
export function configureDockerfile(destination, config) {
  const path = join(destination, "Dockerfile")
  if (!existsSync(path)) return

  writeFileSync(
    path,
    renderDockerfile(readFileSync(path, "utf8"), config.packageManager, {
      yarnMajor: config.yarnMajor ?? 1,
    }),
  )
}

/**
 * Delete the Compose files this topology does not use.
 *
 * An unselected overlay left behind is a file an operator can apply by accident
 * and a second answer to "which database is this project". A local-mode project
 * loses all of them, including the base: it has no Compose topology at all, and
 * shipping one would suggest `docker compose up` is a supported path when the
 * `.env` was written for localhost.
 */
export function pruneComposeFiles(destination, config) {
  for (const file of overlaysToRemove(config)) {
    rmSync(join(destination, file), { force: true })
  }
}
