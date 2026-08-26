/**
 * Turning a database choice into the variables the application and Compose
 * read.
 *
 * TWO RULES FROM EARLIER PHASES, NEITHER NEGOTIABLE HERE:
 *
 *   `DATABASE_DIALECT` is always written explicitly. Phase 5 decided the engine
 *   is never inferred from the URL — MariaDB and MySQL share a URL scheme, so
 *   inference would silently run the wrong dialect's SQL against one of them.
 *
 *   Hostnames belong to a context. Inside Compose the app reaches `postgres`;
 *   outside it, `localhost`. Writing one into the other's configuration
 *   produces a connection error at first boot that reads like a broken install.
 */

/** Compose service name, image, and the variables each engine's service takes. */
const MANAGED = {
  postgresql: {
    service: "postgres",
    overlay: "compose.postgres.yml",
    port: 5432,
    scheme: "postgresql",
    envPrefix: "POSTGRES",
    // `POSTGRES_USER`/`_DB`/`_PASSWORD`, matching compose.postgres.yml.
    keys: { user: "POSTGRES_USER", database: "POSTGRES_DB", password: "POSTGRES_PASSWORD" },
  },
  mysql: {
    service: "mysql",
    overlay: "compose.mysql.yml",
    port: 3306,
    scheme: "mysql",
    envPrefix: "MYSQL",
    keys: {
      user: "MYSQL_USER",
      database: "MYSQL_DATABASE",
      password: "MYSQL_PASSWORD",
      rootPassword: "MYSQL_ROOT_PASSWORD",
    },
  },
  mariadb: {
    service: "mariadb",
    overlay: "compose.mariadb.yml",
    port: 3306,
    // MariaDB speaks the MySQL wire protocol, so the URL scheme is `mysql://`
    // while the DIALECT is `mariadb`. That mismatch is exactly why the dialect
    // is a separate variable and never derived from the URL.
    scheme: "mysql",
    envPrefix: "MARIADB",
    keys: {
      user: "MARIADB_USER",
      database: "MARIADB_DATABASE",
      password: "MARIADB_PASSWORD",
      rootPassword: "MARIADB_ROOT_PASSWORD",
    },
  },
}

export function isManaged(database) {
  return database !== "sqlite"
}

export function overlayFor(database) {
  return MANAGED[database]?.overlay ?? null
}

export function serviceFor(database) {
  return MANAGED[database]?.service ?? null
}

/**
 * SQLite's path, which differs by deployment mode and does so deliberately.
 *
 * Docker uses `/data/app.db` on the `flowcms-data` volume — never inside the
 * image, so an upgrade replaces the container and keeps the site. Local mode
 * uses a project-relative path, which is what `.env.example` already documents
 * and what `.gitignore` already excludes.
 */
export function sqliteUrlFor(deploymentMode) {
  return deploymentMode === "docker" ? "file:/data/app.db" : "file:data/app.db"
}

/**
 * The app-facing variables: dialect and one URL.
 *
 * Exactly one URL, and it is the operator's actual choice. Alternatives belong
 * in `.env.example`, which documents every engine; a generated `.env` carrying
 * three commented-out URLs is a file where nobody can tell which one is live.
 */
/** @returns {Record<string, string>} */
export function buildDatabaseEnv(config) {
  const { database, deploymentMode, externalDatabaseUrl, secrets } = config

  if (database === "sqlite") {
    return { DATABASE_DIALECT: "sqlite", DATABASE_URL: sqliteUrlFor(deploymentMode) }
  }

  const managed = MANAGED[database]

  // An external database the operator named. Preserved verbatim: a URL is a
  // credential, and parsing one apart to rebuild it is how a password
  // containing `@` or `/` gets corrupted by an installer trying to be helpful.
  if (externalDatabaseUrl) {
    return { DATABASE_DIALECT: database, DATABASE_URL: externalDatabaseUrl }
  }

  // Docker-managed: the host is the Compose service name, reachable only on the
  // Docker network. Nothing publishes the port to the host.
  const host = deploymentMode === "docker" ? managed.service : "localhost"
  const auth = `flowcms:${encodeURIComponent(secrets.databasePassword)}`

  return {
    DATABASE_DIALECT: database,
    DATABASE_URL: `${managed.scheme}://${auth}@${host}:${managed.port}/flowcms`,
  }
}

/**
 * The variables the DATABASE SERVICE takes, for Docker-managed engines.
 *
 * Separate from the app's variables because they are consumed by a different
 * thing: Compose passes these to the database container, and the app never sees
 * them. They exist only when the installer is managing the database.
 *
 * The user and database name are `flowcms` — readable, and not a secret. The
 * PASSWORD is generated: `flowcms`, `password`, `changeme` and `root` are the
 * four values every scanner tries first.
 */
/** @returns {Record<string, string>} */
export function buildDatabaseServiceEnv(config) {
  const { database, deploymentMode, externalDatabaseUrl, secrets } = config
  if (deploymentMode !== "docker" || !isManaged(database) || externalDatabaseUrl) return {}

  const { keys } = MANAGED[database]
  const env = {
    [keys.user]: "flowcms",
    [keys.database]: "flowcms",
    [keys.password]: secrets.databasePassword,
  }

  // MySQL and MariaDB images demand a root password even when the application
  // never uses the root account. Generated independently of the app password so
  // one leaking does not hand over the other.
  if (keys.rootPassword) env[keys.rootPassword] = secrets.databaseRootPassword

  return env
}

/** What the summary calls it. */
export function describeDatabase(config) {
  const names = {
    sqlite: "SQLite",
    postgresql: "PostgreSQL",
    mysql: "MySQL",
    mariadb: "MariaDB",
  }
  const name = names[config.database]
  if (config.database === "sqlite") return `${name} (file)`
  if (config.externalDatabaseUrl) return `${name} (external)`
  return config.deploymentMode === "docker" ? `${name} (managed by Compose)` : `${name} (local server)`
}
