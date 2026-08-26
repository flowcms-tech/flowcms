import {
  DATABASES,
  DEPLOYMENT_MODES,
  PACKAGE_MANAGERS,
  REDIS_MODES,
  STORAGE_MODES,
  SUMMARY_FIELDS,
  defaultsFor,
} from "./model.mjs"
import { validateAdminPath } from "./adminPath.mjs"
import { validateExternalStorage, describeStorage } from "./storage.mjs"
import { validateRedisUrl, describeRedis } from "./redis.mjs"
import { describeDatabase } from "./database.mjs"

/**
 * The gate between "answers" and "files".
 *
 * Everything is validated HERE, once, before a single file is written. A
 * configuration that reaches a renderer is one that has already been checked,
 * which is what lets the renderers be plain functions with no defensive
 * branches — and what stops a bad answer from being discovered halfway through
 * a directory.
 *
 * Nothing in this module touches the filesystem or the network. Validation is
 * about SHAPE: whether a URL parses, whether an enum member is real, whether
 * two answers contradict each other. Whether a database is reachable is
 * runtime's question, and asking it here would be a second implementation of a
 * check `/api/ready` already owns.
 */

export class ConfigError extends Error {
  constructor(problems) {
    super(problems.join("\n"))
    this.name = "ConfigError"
    this.problems = problems
  }
}

function enumProblem(field, value, allowed) {
  return `${field} must be one of: ${allowed.join(", ")} (received ${JSON.stringify(value)})`
}

/**
 * Validate and normalize, or throw with every problem at once.
 *
 * All problems, not the first: an operator running a non-interactive command
 * with three mistakes should learn about three mistakes, not discover them one
 * failed run at a time.
 */
export function validateConfig(config) {
  const problems = []

  if (!DEPLOYMENT_MODES.includes(config.deploymentMode)) {
    problems.push(enumProblem("deployment mode", config.deploymentMode, DEPLOYMENT_MODES))
  }
  if (!PACKAGE_MANAGERS.includes(config.packageManager)) {
    problems.push(enumProblem("package manager", config.packageManager, PACKAGE_MANAGERS))
  }
  if (!DATABASES.includes(config.database)) {
    problems.push(enumProblem("database", config.database, DATABASES))
  }
  if (!STORAGE_MODES.includes(config.storage)) {
    problems.push(enumProblem("storage", config.storage, STORAGE_MODES))
  }
  if (!REDIS_MODES.includes(config.redis)) {
    problems.push(enumProblem("redis", config.redis, REDIS_MODES))
  }

  // -- Combinations that are individually valid and together are not ---------

  if (config.storage === "garage" && config.deploymentMode === "local") {
    problems.push(
      "Garage is a Docker Compose service, so it cannot be the storage for a local " +
        "deployment. Choose external S3-compatible storage, or deploy with Docker.",
    )
  }

  if (config.redis === "bundled" && config.deploymentMode === "local") {
    problems.push(
      "The bundled Redis is a Docker Compose service. For a local deployment choose " +
        "an external Redis URL, or none.",
    )
  }

  if (config.redis === "external" && !config.redisUrl) {
    problems.push("An external Redis needs a URL.")
  }

  // -- Admin path ------------------------------------------------------------

  const adminPath = validateAdminPath(config.adminPath)
  if (!adminPath.ok) {
    problems.push(`Invalid admin path: ${adminPath.reason}`)
  }

  // -- Storage ---------------------------------------------------------------

  if (config.storage === "s3") {
    for (const problem of validateExternalStorage(config.externalStorage)) {
      problems.push(`S3 storage: ${problem}`)
    }
  }

  // -- Redis -----------------------------------------------------------------

  if (config.redis === "external" && config.redisUrl) {
    for (const problem of validateRedisUrl(config.redisUrl)) {
      problems.push(`Redis: ${problem}`)
    }
  }

  // -- External database -----------------------------------------------------

  if (config.externalDatabaseUrl) {
    if (config.database === "sqlite") {
      problems.push("SQLite is a file, not a server; it takes no external database URL.")
    }
    if (new RegExp("[\\u0000-\\u001f\\u007f]").test(config.externalDatabaseUrl)) {
      // Never quotes the value: a database URL carries a password.
      problems.push("The database URL contains a newline or control character.")
    }
  }

  // -- Base URL --------------------------------------------------------------

  if (config.baseUrl) {
    try {
      const url = new URL(config.baseUrl)
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        problems.push("The base URL must be an http:// or https:// URL.")
      }
    } catch {
      problems.push("The base URL is not a valid URL.")
    }
  }

  // -- Secrets ---------------------------------------------------------------

  const secrets = config.secrets ?? {}
  for (const required of ["authSecret", "captchaSecret", "setupToken", "previewSecret"]) {
    if (typeof secrets[required] !== "string" || secrets[required].length < 32) {
      problems.push(`A generated ${required} is missing or too short.`)
    }
  }

  // Independence is a property worth asserting rather than assuming: one call
  // reused four times would give every deployment a single key that unlocks
  // sessions, the CAPTCHA, setup and previews at once.
  const generated = ["authSecret", "captchaSecret", "setupToken", "previewSecret"]
    .map((key) => secrets[key])
    .filter(Boolean)
  if (new Set(generated).size !== generated.length) {
    problems.push("Generated secrets must be independent; two of them are identical.")
  }

  if (problems.length > 0) throw new ConfigError(problems)

  return { ...config, adminPath: adminPath.value }
}

/**
 * Fill in what the operator did not choose.
 *
 * Applied BEFORE validation, so a default that contradicts another answer is
 * caught by the same rules an explicit answer would be. Storage is the one that
 * depends on another field — Garage is not available outside Docker — so it
 * comes from `defaultsFor(mode)` rather than a constant.
 */
export function applyDefaults(partial) {
  const deploymentMode = partial.deploymentMode ?? defaultsFor("docker").deploymentMode
  const defaults = defaultsFor(deploymentMode)

  return {
    deploymentMode,
    packageManager: partial.packageManager ?? defaults.packageManager,
    database: partial.database ?? defaults.database,
    storage: partial.storage ?? defaults.storage,
    redis: partial.redis ?? defaults.redis,
    adminPath: partial.adminPath ?? defaults.adminPath,
    baseUrl: partial.baseUrl ?? defaults.baseUrl,
    port: partial.port ?? defaults.port,
    projectName: partial.projectName ?? null,
    externalStorage: partial.externalStorage ?? null,
    externalDatabaseUrl: partial.externalDatabaseUrl ?? null,
    redisUrl: partial.redisUrl ?? null,
    secrets: partial.secrets ?? null,
  }
}

/**
 * What may be shown to a person.
 *
 * BUILT FROM A WHITELIST, and that is the entire security property. A summary
 * assembled by taking the config and deleting the sensitive parts is a summary
 * that leaks the next secret somebody adds; this one cannot show a field
 * nobody listed.
 *
 * `SUMMARY_FIELDS` is the list. Secrets are represented by the word
 * "Generated" — an operator needs to know they exist, and needs never to see
 * them in a terminal that scrolls into a screenshot.
 */
export function buildSafeSummary(config) {
  const labels = {
    projectName: "Project",
    deploymentMode: "Deployment",
    packageManager: "Package manager",
    database: "Database",
    storage: "Storage",
    redis: "Redis",
    adminPath: "Admin path",
    baseUrl: "Base URL",
  }

  const values = {
    projectName: config.projectName,
    deploymentMode: config.deploymentMode === "docker" ? "Docker Compose" : "Local Node",
    packageManager: config.packageManager,
    database: describeDatabase(config),
    storage: describeStorage(config),
    redis: describeRedis(config),
    adminPath: config.adminPath,
    baseUrl: config.baseUrl,
  }

  const rows = SUMMARY_FIELDS.filter((field) => values[field] != null).map((field) => [
    labels[field],
    String(values[field]),
  ])

  rows.push(["Secrets", "Generated"])
  return rows
}

/** The summary as aligned lines. */
export function formatSummary(rows) {
  const width = Math.max(...rows.map(([label]) => label.length))
  return rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`).join("\n")
}
