import { generateDeploymentSecret } from "../secrets.mjs"

/**
 * Every secret a generated deployment needs, generated once.
 *
 * INDEPENDENT, EACH OF THEM. One call reused would give an installation a
 * single value that signs sessions, signs the CAPTCHA, opens first-run setup
 * and signs preview links — so one leak would be four, and rotating any of them
 * would rotate all four. `validateConfig` asserts they differ, which turns a
 * copy-paste mistake here into a refused configuration rather than a subtle
 * one.
 *
 * NOTHING RETURNED FROM HERE IS EVER PRINTED. They travel to the env renderer
 * and stop. The summary says "Generated"; the final instructions tell the
 * operator where to find the setup token; no code path formats one into a
 * message.
 */
export function generateSecrets(config) {
  const secrets = {
    // Signs every session token. Phase 7.1.2: a weak one fails open and silent.
    authSecret: generateDeploymentSecret(),
    // Signs the login CAPTCHA challenge. Phase 7.1.1: absent means nobody can
    // sign in, not that the CAPTCHA is off.
    captchaSecret: generateDeploymentSecret(),
    // Gates the public first-run form. Absent LOCKS /setup rather than opening
    // it, so generating one is what makes web setup available at all.
    setupToken: generateDeploymentSecret(),
    // Signs shareable draft links. It has no strength policy of its own — the
    // one deployment secret that does not — but the installer can generate a
    // strong one for free, and scaffolding a weak or missing one buys nothing.
    previewSecret: generateDeploymentSecret(),
    databasePassword: null,
    databaseRootPassword: null,
    garageAccessKeyId: null,
    garageSecretAccessKey: null,
  }

  // Managed database credentials, only when the installer is the one creating
  // the database. An external database already has its own.
  const managed =
    config.deploymentMode === "docker" &&
    config.database !== "sqlite" &&
    !config.externalDatabaseUrl

  if (managed) {
    secrets.databasePassword = generateDeploymentSecret()
    // MySQL and MariaDB images require a root password even though FlowCMS
    // never uses the root account. Separate from the application's password so
    // one leaking does not hand over the other.
    if (config.database === "mysql" || config.database === "mariadb") {
      secrets.databaseRootPassword = generateDeploymentSecret()
    }
  }

  if (config.deploymentMode === "docker" && config.storage === "garage") {
    // Garage bootstraps itself from these on first start and is idempotent
    // afterwards, so a restart neither regenerates them nor disturbs data.
    // The access key id is not a secret in the way the secret key is, but it is
    // generated rather than fixed for the same reason a username is not `admin`.
    secrets.garageAccessKeyId = generateDeploymentSecret()
    secrets.garageSecretAccessKey = generateDeploymentSecret()
  }

  return secrets
}
