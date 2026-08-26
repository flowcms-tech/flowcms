import { UsageError } from "../args.mjs"
import { applyDefaults, validateConfig, ConfigError } from "./validate.mjs"
import { generateSecrets } from "./secrets.mjs"
import { collectInteractively } from "../prompts/interactive.mjs"

/**
 * From command-line options to a validated deployment configuration.
 *
 * THE ONE DECISION THIS MODULE MAKES is whether anybody can be asked. Everything
 * else follows from it:
 *
 *   a TTY, and something missing   → ask
 *   no TTY, and something missing  → fail, naming the flag
 *   nothing missing                → proceed, identically either way
 *
 * A command with every flag supplied behaves the same whether or not a terminal
 * is attached, which is what makes the CLI usable from CI and from a future
 * automated installer. Nothing is silently guessed: an installer that quietly
 * picked SQLite because it could not ask would be choosing somebody's database
 * for them.
 */

/**
 * External credentials, read from the environment rather than from flags.
 *
 * A SEPARATE NAMESPACE from the application's own variables, deliberately. If
 * this read `S3_SECRET_ACCESS_KEY`, a machine that already had FlowCMS's
 * runtime environment loaded would silently configure a new project with the
 * old installation's credentials — inherited by accident, and correct-looking.
 * `FLOWCMS_INSTALL_` says "this is input to the installer" and cannot be
 * confused with anything the running application reads.
 *
 * Environment rather than flags because a flag is shell history, `ps` output
 * and a CI log.
 */
export const INSTALL_ENV = {
  s3Endpoint: "FLOWCMS_INSTALL_S3_ENDPOINT",
  s3Region: "FLOWCMS_INSTALL_S3_REGION",
  s3Bucket: "FLOWCMS_INSTALL_S3_BUCKET",
  s3AccessKeyId: "FLOWCMS_INSTALL_S3_ACCESS_KEY_ID",
  s3SecretAccessKey: "FLOWCMS_INSTALL_S3_SECRET_ACCESS_KEY",
  databaseUrl: "FLOWCMS_INSTALL_DATABASE_URL",
  redisUrl: "FLOWCMS_INSTALL_REDIS_URL",
}

function readInstallEnv(env) {
  const external = {
    endpoint: env[INSTALL_ENV.s3Endpoint],
    region: env[INSTALL_ENV.s3Region],
    bucket: env[INSTALL_ENV.s3Bucket],
    accessKeyId: env[INSTALL_ENV.s3AccessKeyId],
    secretAccessKey: env[INSTALL_ENV.s3SecretAccessKey],
  }

  return {
    // All five or none: a partially-configured endpoint is worse than an
    // unconfigured one, because it looks configured.
    externalStorage: Object.values(external).every(Boolean) ? external : null,
    externalDatabaseUrl: env[INSTALL_ENV.databaseUrl] ?? null,
    redisUrl: env[INSTALL_ENV.redisUrl] ?? null,
  }
}

/** What is still unanswered, as the flag an operator would have used. */
function missingFlags(partial) {
  const missing = []
  const flagFor = {
    deploymentMode: "--deployment",
    packageManager: "--package-manager",
    database: "--database",
    storage: "--storage",
    redis: "--redis",
  }

  for (const [key, flag] of Object.entries(flagFor)) {
    if (!partial[key]) missing.push(flag)
  }
  return missing
}

/**
 * Requirements that only appear once other answers are known.
 *
 * External storage needs credentials; an external Redis needs a URL; a
 * server-backed database outside Docker needs a connection string, because
 * there is no Compose service for the installer to create.
 */
function missingSecrets(partial) {
  const missing = []

  if (partial.storage === "s3" && !partial.externalStorage) {
    missing.push(
      `external S3 credentials — set ${INSTALL_ENV.s3Endpoint}, ${INSTALL_ENV.s3Region}, ` +
        `${INSTALL_ENV.s3Bucket}, ${INSTALL_ENV.s3AccessKeyId} and ${INSTALL_ENV.s3SecretAccessKey}`,
    )
  }

  if (partial.redis === "external" && !partial.redisUrl) {
    missing.push(`a Redis URL — set ${INSTALL_ENV.redisUrl}`)
  }

  if (
    partial.database !== "sqlite" &&
    partial.deploymentMode === "local" &&
    !partial.externalDatabaseUrl
  ) {
    missing.push(
      `a database URL — set ${INSTALL_ENV.databaseUrl}. A local deployment has no ` +
        "Compose service for the installer to create, so the database is yours",
    )
  }

  return missing
}

/**
 * Resolve a complete configuration, asking only when it is possible and needed.
 *
 * @param {object} options parsed command-line options
 * @param {object} deps    injected for tests: env, tty, prompt, secret generator
 */
export async function resolveConfig(options, deps = {}) {
  const env = deps.env ?? process.env
  const isInteractive = deps.isInteractive ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY))
  const prompt = deps.prompt ?? collectInteractively
  const makeSecrets = deps.generateSecrets ?? generateSecrets

  const fromEnv = readInstallEnv(env)
  let partial = {
    deploymentMode: options.deploymentMode,
    packageManager: options.packageManager,
    database: options.database,
    storage: options.storage,
    redis: options.redis,
    adminPath: options.adminPath,
    baseUrl: options.baseUrl,
    projectName: options.projectName,
    ...fromEnv,
  }

  let session = null
  const outstanding = missingFlags(partial)

  if (outstanding.length > 0 || missingSecrets(partial).length > 0) {
    if (!isInteractive()) {
      const problems = [
        ...outstanding.map((flag) => `${flag} is required in a non-interactive run`),
        ...missingSecrets(partial),
      ]
      throw new UsageError(
        `Not enough configuration to create a project without asking:\n` +
          problems.map((problem) => `  - ${problem}`).join("\n") +
          `\n\nRun create-flowcms --help, or run it in a terminal to be asked.`,
      )
    }

    session = await prompt(partial, deps)
    partial = { ...partial, ...session.answers }
  }

  // Defaults BEFORE validation, so a default that contradicts another answer is
  // caught by the same rules an explicit answer would be.
  const withDefaults = applyDefaults({ ...partial, projectName: options.projectName })
  const secrets = makeSecrets(withDefaults)
  const config = validateConfig({ ...withDefaults, secrets })

  return { config, session }
}

export { ConfigError }
