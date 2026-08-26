import { basename } from "node:path"
import { UsageError } from "./args.mjs"

/**
 * The npm package name for a generated project, derived from its directory.
 *
 * It goes into a `"private": true` manifest that is never published, so this is
 * not about registry etiquette — it is about `npm install` refusing to run at
 * all on a manifest whose `name` is invalid. A scaffolder that produces a
 * project npm rejects has produced nothing.
 *
 * NORMALISATION IS DELIBERATELY NARROW. Lowercasing and turning runs of
 * unsupported characters into a single hyphen covers "My Site" and
 * "my_site" — the cases where an operator's intent is obvious. Anything left
 * over is REFUSED rather than mangled: silently turning "🚀" into "project"
 * gives somebody a name they did not choose and would not have guessed.
 */

/** npm's rule, minus the scope form: a generated project is never scoped. */
const VALID = /^[a-z0-9][a-z0-9._-]*$/

/**
 * Names npm itself will not install under.
 *
 * `node_modules` and `favicon.ico` are npm's own reserved words. `flowcms` is
 * ours: a project directory called `flowcms` would give the application the
 * same name as the package it depends on, and npm refuses to install a package
 * under a package of the same name — the exact wall Phase 7.2 hit when the
 * repository root was still called `flowcms`. Better to say so here than to let
 * `npm install` fail three steps later with a message about neither.
 */
const RESERVED = new Map([
  ["node_modules", "npm reserves this name."],
  ["favicon.ico", "npm reserves this name."],
  [
    "flowcms",
    "the project would share its name with the `flowcms` package it depends on, " +
      "and npm refuses to install a package under a package of the same name.",
  ],
])

export function deriveProjectName(destinationPath) {
  const raw = basename(destinationPath)
  const normalized = raw
    .trim()
    .toLowerCase()
    // Anything npm does not accept becomes a separator, then runs collapse.
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    // npm rejects a leading dot or underscore; a trailing separator is noise.
    .replace(/^[-._]+/, "")
    .replace(/[-._]+$/, "")

  if (normalized === "") {
    throw new UsageError(
      `Cannot derive a package name from "${raw}". Choose a directory name that ` +
        "contains letters or digits.",
    )
  }

  if (normalized.length > 214) {
    throw new UsageError(`"${raw}" is too long for an npm package name (max 214 characters).`)
  }

  if (!VALID.test(normalized)) {
    throw new UsageError(`Cannot derive a valid package name from "${raw}".`)
  }

  const reserved = RESERVED.get(normalized)
  if (reserved) {
    throw new UsageError(`"${raw}" cannot be used as a project name: ${reserved}`)
  }

  return normalized
}
