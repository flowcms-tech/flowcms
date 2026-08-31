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
 * EXACTLY ONE OF THESE IS EVER PRINTED: the setup token. Everything else
 * travels to the env renderer and stops — the summary says "Generated" and no
 * code path formats the value into a message.
 *
 * The token is the deliberate exception, made when the first-run setup form was
 * reworked. It authorizes one action once; afterwards the endpoint is gone and
 * the value is inert, so the cost of showing it is bounded to terminal output,
 * and it buys an operator who would otherwise be stuck on the first screen they
 * ever see. That reasoning does not extend to any other value here, all of
 * which stay valid for the life of the installation.
 *
 * `tests/scaffolder/orchestration.test.ts` holds the line: it reads the
 * generated `.env` and asserts, by value, that the token is printed and that
 * nothing else is.
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
