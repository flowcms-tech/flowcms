import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Apply pending migrations for the configured dialect, then exit.
 *
 * Plain ESM JavaScript because this runs inside the production container, which
 * has no TypeScript loader. It therefore reimplements the small amount of
 * dialect/URL validation that `src/Framework/Config/databaseConfig.ts` owns —
 * and `tests/config/migrateParity.test.ts` runs the same inputs through both
 * and fails if they ever disagree, so the duplication cannot drift into two
 * different ideas of what a valid configuration is.
 *
 * Credentials are redacted from every message. A migration failure is exactly
 * when a connection string is most likely to be pasted into a bug report.
 */

const DIALECTS = ["sqlite", "postgresql", "mysql", "mariadb"]

const ACCEPTED_SCHEMES = {
  sqlite: ["file:"],
  postgresql: ["postgresql:", "postgres:"],
  mysql: ["mysql:"],
  mariadb: ["mysql:", "mariadb:"],
}

const DRIVER_FAMILY = {
  sqlite: "sqlite",
  postgresql: "postgresql",
  mysql: "mysql",
  mariadb: "mysql",
}

/** Migration directory per driver family — MariaDB shares MySQL's SQL. */
const MIGRATIONS_DIR = {
  sqlite: "sqlite",
  postgresql: "postgresql",
  mysql: "mysql",
}

export function redactDatabaseUrl(url) {
  if (typeof url !== "string" || url.trim() === "") return "(unset)"
  try {
    const parsed = new URL(url)
    if (!parsed.password) return url
    parsed.password = "***"
    return parsed.toString()
  } catch {
    const scheme = String(url).split(":", 1)[0]
    return /^[a-z][a-z0-9+.-]*$/i.test(scheme)
      ? `${scheme}://(unparseable, redacted)`
      : "(unparseable, redacted)"
  }
}

export function resolveConfig(env) {
  const url = (env.DATABASE_URL ?? "").trim()
  if (url === "") throw new Error("Invalid database configuration: DATABASE_URL is required")

  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url)
  if (!match) {
    throw new Error(
      `Invalid database configuration: DATABASE_URL has no scheme (${redactDatabaseUrl(url)})`,
    )
  }
  const scheme = `${match[1].toLowerCase()}:`

  const raw = (env.DATABASE_DIALECT ?? "").trim()
  let dialect
  if (raw === "") {
    if (scheme !== "file:") {
      throw new Error(
        `Invalid database configuration: DATABASE_DIALECT is required for a ${scheme}// URL ` +
          `— it cannot be inferred, because MySQL and MariaDB share a URL scheme.`,
      )
    }
    dialect = "sqlite"
  } else {
    if (!DIALECTS.includes(raw)) {
      throw new Error(
        `Invalid database configuration: DATABASE_DIALECT "${raw}" is not supported ` +
          `— expected one of ${DIALECTS.join(", ")}`,
      )
    }
    dialect = raw
  }

  if (!ACCEPTED_SCHEMES[dialect].includes(scheme)) {
    throw new Error(
      `Invalid database configuration: DATABASE_DIALECT is "${dialect}" but DATABASE_URL uses ` +
        `"${scheme}//". Refusing to guess which one you meant.`,
    )
  }

  return { dialect, driverFamily: DRIVER_FAMILY[dialect], url, safeUrl: redactDatabaseUrl(url) }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Bounded retry. Remote engines take time to initialise on a first
 * `docker compose up`, so migrating the instant the container starts loses a
 * race it could have waited out. Bounded, because retrying forever turns a
 * wrong password into a container that looks busy rather than broken.
 */
async function withRetry(label, attempts, fn) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === attempts) break
      const delay = Math.min(500 * 2 ** (attempt - 1), 5000)
      console.log(`${label}: not ready (attempt ${attempt}/${attempts}), retrying in ${delay}ms`)
      await sleep(delay)
    }
  }
  throw lastError
}

async function main() {
  const config = resolveConfig(process.env)
  const folder = resolve(
    import.meta.dirname,
    `../src/db/migrations/${MIGRATIONS_DIR[config.driverFamily]}`,
  )

  console.log(`FlowCMS: migrating ${config.dialect} (${config.safeUrl})`)

  if (config.driverFamily === "sqlite") {
    const { createClient } = await import("@libsql/client")
    const { drizzle } = await import("drizzle-orm/libsql")
    const { migrate } = await import("drizzle-orm/libsql/migrator")

    // libsql creates the database file but not the directory above it.
    mkdirSync(dirname(resolve(config.url.replace(/^file:/, ""))), { recursive: true })

    const client = createClient({ url: config.url })
    try {
      await migrate(drizzle(client), { migrationsFolder: folder })
    } finally {
      client.close()
    }
  } else if (config.driverFamily === "postgresql") {
    const { default: postgres } = await import("postgres")
    const { drizzle } = await import("drizzle-orm/postgres-js")
    const { migrate } = await import("drizzle-orm/postgres-js/migrator")

    const client = postgres(config.url, { max: 1, onnotice: () => {} })
    try {
      await withRetry("postgresql", 12, () => client`select 1`)
      await migrate(drizzle(client), { migrationsFolder: folder })
    } finally {
      await client.end({ timeout: 5 })
    }
  } else {
    const { default: mysql } = await import("mysql2/promise")
    const { drizzle } = await import("drizzle-orm/mysql2")
    const { migrate } = await import("drizzle-orm/mysql2/migrator")

    const connection = await withRetry("mysql", 12, () =>
      mysql.createConnection({ uri: config.url, multipleStatements: true }),
    )
    try {
      await migrate(drizzle(connection), { migrationsFolder: folder })
    } finally {
      await connection.end()
    }
  }

  console.log(`Migrations applied (${config.dialect}).`)
}

/**
 * Run migrations ONLY when this file is the process entry point.
 *
 * It used to run on import, and `scripts/bootstrap-owner.mjs` imports
 * `resolveConfig` from here — so bootstrapping an owner silently kicked off a
 * migration in the background and then queried tables that migration had not
 * finished creating. Against an already-migrated database the extra run is a
 * fast no-op and the race is invisible; against a fresh one, bootstrap fails
 * with `no such table`. Phase 7.1 caught it because bootstrap now touches
 * `settings` as well as `user`.
 *
 * Importing a module must not start work. Every caller that wants migrations
 * runs this file directly — `docker/entrypoint.sh`, `bun run db:migrate` — so
 * nothing depended on the side effect except by accident.
 */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Redact defensively: a driver error can embed the connection string.
    const raw = error instanceof Error ? error.message : String(error)
    const url = process.env.DATABASE_URL
    const message = url ? raw.split(url).join(redactDatabaseUrl(url)) : raw
    console.error("Migration failed:", message)
    process.exitCode = 1
  })
}
