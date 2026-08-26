/**
 * The deployment configuration a generated project is created from.
 *
 * ONE TYPED OBJECT, passed whole. Every renderer takes this and nothing else,
 * which is what keeps prompts, flags and tests interchangeable: there is no
 * path where a loose string travels from an answer to a file.
 *
 * WHAT IT IS NOT: CMS state. Nothing here is a site name, an owner, a theme or
 * a piece of content. The installer configures infrastructure; `/setup` creates
 * the first owner and the site identity; the admin panel owns everything after
 * that. Those three are separate lifecycles and blurring them is how an
 * installer ends up owning data it cannot migrate.
 */

export const DEPLOYMENT_MODES = ["docker", "local"]
export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"]

/**
 * Exactly one is active in a generated project.
 *
 * The APPLICATION keeps support code for all four — the installer configures a
 * database, it does not remove the others. An operator who changes their mind
 * edits `.env` and restarts.
 *
 * MariaDB is its own choice, not an alias of MySQL. It runs a different image,
 * takes differently-named environment variables, and the runtime dialect is
 * `mariadb`; collapsing the two in the UI would be presenting a lie about what
 * gets deployed.
 */
export const DATABASES = ["sqlite", "postgresql", "mysql", "mariadb"]

/**
 * `garage` is the bundled single-node S3 service; `s3` is any external
 * S3-compatible endpoint.
 *
 * There is deliberately no third option. FlowCMS has no local-filesystem media
 * backend — images are served through `/api/public/images` from object storage,
 * and adding a filesystem path here would be inventing a storage mode the
 * application does not implement.
 */
export const STORAGE_MODES = ["garage", "s3"]

export const REDIS_MODES = ["none", "bundled", "external"]

/**
 * Defaults, and each one is a product decision already made elsewhere.
 *
 * They appear in the confirmation summary rather than being applied silently:
 * an operator who never chose a database should still be told which one they
 * are getting.
 */
export const DEFAULTS = {
  deploymentMode: "docker",
  packageManager: "npm",
  // What compose.yml already defaults to, and the only engine that needs no
  // service, no credentials and no second container.
  database: "sqlite",
  // Docker's default in compose.yml. Local mode has no bundled Garage to point
  // at, so its default is computed rather than fixed — see defaultsFor().
  storage: "garage",
  // The application degrades correctly without it: the login rate limiter falls
  // back to a per-process implementation. It matters for more than one replica.
  redis: "none",
  adminPath: "/admin",
  baseUrl: "http://localhost:3000",
  port: 3000,
}

/**
 * Defaults that depend on another answer.
 *
 * Only storage does today: Garage is a Compose service, so it is not a default
 * anything outside Docker can honour.
 */
export function defaultsFor(deploymentMode) {
  return {
    ...DEFAULTS,
    storage: deploymentMode === "local" ? "s3" : "garage",
  }
}

/**
 * A shape, not a class.
 *
 * Kept as a plain object so it serialises for tests and for a future
 * `--config` input without a constructor in the way.
 *
 * @typedef {object} DeploymentConfig
 * @property {"docker"|"local"} deploymentMode
 * @property {"npm"|"pnpm"|"yarn"|"bun"} packageManager
 * @property {"sqlite"|"postgresql"|"mysql"|"mariadb"} database
 * @property {"garage"|"s3"} storage
 * @property {"none"|"bundled"|"external"} redis
 * @property {string} adminPath
 * @property {string} baseUrl
 * @property {number} port
 * @property {string} projectName
 * @property {ExternalStorage|null} externalStorage
 * @property {string|null} externalDatabaseUrl
 * @property {string|null} redisUrl
 * @property {Secrets} secrets
 */

/**
 * Operator-supplied S3 credentials. Never printed, never stored in the project
 * marker, never accepted as a command-line flag.
 *
 * @typedef {object} ExternalStorage
 * @property {string} endpoint
 * @property {string} region
 * @property {string} bucket
 * @property {string} accessKeyId
 * @property {string} secretAccessKey
 */

/**
 * Every value the installer generates. All independent.
 *
 * @typedef {object} Secrets
 * @property {string} authSecret
 * @property {string} captchaSecret
 * @property {string} setupToken
 * @property {string} previewSecret
 * @property {string|null} databasePassword    managed Docker databases only
 * @property {string|null} garageAccessKeyId
 * @property {string|null} garageSecretAccessKey
 */

/**
 * The fields a summary may contain.
 *
 * A WHITELIST, and that is the point: a summary is built by picking from this
 * list rather than by taking the config and deleting the dangerous parts.
 * Redaction that works by omission is redaction somebody forgets when they add
 * a field; this way a new secret is invisible by default.
 */
export const SUMMARY_FIELDS = [
  "projectName",
  "deploymentMode",
  "packageManager",
  "database",
  "storage",
  "redis",
  "adminPath",
  "baseUrl",
]

/** Fields that must never leave the process except into the env file. */
export const SECRET_FIELDS = [
  "authSecret",
  "captchaSecret",
  "setupToken",
  "previewSecret",
  "databasePassword",
  "garageAccessKeyId",
  "garageSecretAccessKey",
  "accessKeyId",
  "secretAccessKey",
  "externalDatabaseUrl",
]
