import { SECRET_FIELDS } from "../config/model.mjs"

/**
 * `.flowcms/project.json` — what generated this project, and how.
 *
 * ITS PURPOSE IS FUTURE TOOLING. An upgrade path from one template version to
 * the next has to know which one it is looking at, and asking the operator is
 * not an answer. Recording the deployment choices alongside it means a future
 * `flowcms upgrade` can tell a Postgres-on-Docker project from a SQLite-local
 * one without guessing from file contents.
 *
 * WHAT IT MUST NEVER CONTAIN is anything that would be a leak if this file were
 * committed — and it IS committed, unlike `.env`. So: no password, no key, no
 * token, and no database or Redis URL, because a URL carries credentials in its
 * userinfo. Only the SHAPE of the choice.
 *
 * `assertNoSecrets` below is not defensive decoration. This file is the one
 * place where a future contributor adding "just the connection string, for
 * diagnostics" would be adding a credential to version control, and a build
 * that refuses is a better answer than a review that might catch it.
 */
export function buildProjectMarker(config, { templateVersion, cliVersion }) {
  const marker = {
    templateVersion,
    createdWith: `create-flowcms@${cliVersion}`,
    deploymentMode: config.deploymentMode,
    packageManager: config.packageManager,
    // The dialect, not the URL. `postgresql` says everything tooling needs and
    // nothing an attacker does.
    databaseDialect: config.database,
    // `garage` or `s3` — never the endpoint, which can carry userinfo.
    storageMode: config.storage,
    redisMode: config.redis,
    adminPath: config.adminPath,
  }

  assertNoSecrets(marker, config)
  return marker
}

/**
 * Refuse to write a marker containing a generated secret.
 *
 * Checks by VALUE rather than by key name: a field called `note` holding the
 * setup token would pass a key check and fail this one, and that is the shape
 * the mistake actually takes.
 */
export function assertNoSecrets(marker, config) {
  const serialized = JSON.stringify(marker)
  const secrets = config.secrets ?? {}

  for (const field of SECRET_FIELDS) {
    const value = secrets[field] ?? config.externalStorage?.[field] ?? config[field]
    if (typeof value === "string" && value.length > 0 && serialized.includes(value)) {
      // Names the FIELD, never the value.
      throw new Error(
        `.flowcms/project.json would contain the value of "${field}". ` +
          `This file is committed; secrets belong in .env.`,
      )
    }
  }

  // A URL is a credential carrier even when it happens not to have userinfo
  // today, so the shape is refused outright rather than inspected.
  for (const [key, value] of Object.entries(marker)) {
    if (typeof value === "string" && /:\/\//.test(value)) {
      throw new Error(`.flowcms/project.json must not contain a URL ("${key}").`)
    }
  }

  return true
}
