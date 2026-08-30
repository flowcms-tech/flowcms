import { overlayFor } from "../config/database.mjs"
import { redisProfileFor } from "../config/redis.mjs"

/**
 * Which Compose files a generated project uses, and how it is told.
 *
 * NO YAML IS GENERATED HERE, on purpose. The repository's overlays already
 * express every topology cleanly — one file per database, one to disable
 * Garage, a profile for Redis — and reimplementing that as string assembly in
 * an installer would duplicate substantial logic that is certain to drift from
 * the files it was copied from.
 *
 * Instead the selection is written into `.env`, which Compose reads for its own
 * configuration:
 *
 *     COMPOSE_PATH_SEPARATOR=:
 *     COMPOSE_FILE=compose.yml:compose.postgres.yml
 *     COMPOSE_PROFILES=redis
 *
 * and the overlays that were NOT selected are deleted from the project. The
 * operator types `docker compose up -d` — no flags, no remembering which of six
 * files applies — and gets exactly one database, Garage only if they chose it,
 * Redis only if they chose it.
 *
 * `COMPOSE_PATH_SEPARATOR` is written explicitly because Compose's default
 * differs by platform (`:` on POSIX, `;` on Windows) and this file is committed
 * and shared. Pinning it means the project behaves the same wherever it is
 * cloned.
 */

/** Every overlay the template ships, so unselected ones can be removed. */
export const ALL_OVERLAYS = [
  "compose.postgres.yml",
  "compose.mysql.yml",
  "compose.mariadb.yml",
  "compose.external-s3.yml",
  "compose.local-storage.yml",
  "compose.dev.yml",
]

/**
 * The ordered file list, base first.
 *
 * Order matters to Compose: later files override earlier ones, which is how a
 * database overlay replaces the app's `DATABASE_URL` and how the external-S3
 * overlay moves Garage into an unused profile.
 */
export function composeFilesFor(config) {
  if (config.deploymentMode !== "docker") return []

  const files = ["compose.yml"]

  const database = overlayFor(config.database)
  if (database) files.push(database)

  // NEITHER STORAGE OVERLAY ADDS A SERVICE — each REMOVES one, by assigning
  // Garage a profile nothing activates. The app's `depends_on` for garage is
  // `required: false`, so it starts normally with the service absent.
  //
  // Two files rather than one shared "no-garage" overlay: a generated project
  // records its overlay list in `.env`, and a local-storage install whose
  // COMPOSE_FILE named `compose.external-s3.yml` would be describing itself as
  // something it is not.
  //
  // `garage` selects no overlay at all, because the bundled service is what the
  // base `compose.yml` already starts.
  if (config.storage === "s3") files.push("compose.external-s3.yml")
  if (config.storage === "local") files.push("compose.local-storage.yml")

  return files
}

/** Profiles that must be active. Redis is the only one today. */
export function composeProfilesFor(config) {
  const redis = redisProfileFor(config)
  return redis ? [redis] : []
}

/**
 * A Compose project name derived from the site's own name.
 *
 * THIS IS NOT COSMETIC. `compose.yml` carries `name: flowcms`, so without an
 * override every FlowCMS site on a host shares one set of container names,
 * networks and VOLUMES. Two sites on one machine is not an exotic case — it is
 * a staging copy beside a production one — and the failure is silent and
 * destructive: `docker compose up -d` in the second adopts and recreates the
 * first's containers, and `docker compose down -v` in either deletes the
 * other's database.
 *
 * Compose's precedence is `-p` > `COMPOSE_PROJECT_NAME` > the file's `name:`,
 * so writing it here wins without editing the committed YAML.
 *
 * Compose accepts only lowercase letters, digits, dash and underscore, and must
 * start with a letter or digit. A project name is already lowercase and npm-safe
 * but may contain dots (`site.example.com`), so it is narrowed rather than
 * trusted.
 */
export function composeProjectName(projectName) {
  const cleaned = String(projectName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "")
  return cleaned === "" ? "flowcms" : cleaned
}

/** The `.env` entries that tell Compose the above. */
/** @returns {Record<string, string>} */
export function composeEnvFor(config) {
  const files = composeFilesFor(config)
  if (files.length === 0) return {}

  const env = {
    COMPOSE_PATH_SEPARATOR: ":",
    COMPOSE_PROJECT_NAME: composeProjectName(config.projectName),
    COMPOSE_FILE: files.join(":"),
  }

  const profiles = composeProfilesFor(config)
  if (profiles.length > 0) env.COMPOSE_PROFILES = profiles.join(",")

  return env
}

/**
 * Overlays to delete from the generated project.
 *
 * An unselected overlay left in place is a file an operator can apply by
 * accident and a second answer to "which database is this". `compose.dev.yml`
 * is kept for every Docker project — it is a development convenience that
 * layers hot reload onto whatever topology was chosen, not a topology of its
 * own.
 *
 * A local-mode project keeps none of them: it has no Compose topology at all.
 */
export function overlaysToRemove(config) {
  if (config.deploymentMode !== "docker") {
    return [...ALL_OVERLAYS, "compose.yml"]
  }

  const keep = new Set([...composeFilesFor(config), "compose.dev.yml"])
  return ALL_OVERLAYS.filter((file) => !keep.has(file))
}

/**
 * The command an operator runs.
 *
 * Plain, because `COMPOSE_FILE` in `.env` has already said which files apply.
 * A generated instruction listing four `-f` flags would be correct and would
 * also be the thing nobody remembers when they come back in six months.
 */
export function composeUpCommand() {
  return "docker compose up -d"
}
