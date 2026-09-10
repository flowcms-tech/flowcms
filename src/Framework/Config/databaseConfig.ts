/**
 * Database selection, as a pure parser.
 *
 * Reads no environment itself — it takes an env-shaped object — so it is fully
 * unit-testable and safe to import anywhere, matching the pattern
 * `adminPathCore.ts` established in Phase 3.
 *
 * The dialect is EXPLICIT rather than inferred, and that is the central
 * decision here. MySQL and MariaDB share the `mysql://` scheme while being
 * separately supported, separately tested products. Telling them apart by
 * asking the server its version would make the supported matrix depend on a
 * runtime guess, and would answer differently against a proxy, a fork, or a
 * version that has not shipped yet. One environment variable removes the guess.
 */

export type DatabaseDialect = "sqlite" | "postgresql" | "mysql" | "mariadb"

/** Which driver actually speaks to the server. MariaDB uses the MySQL driver
 *  while remaining a distinct dialect for testing and documentation. */
export type DriverFamily = "sqlite" | "postgresql" | "mysql"

export interface DatabaseConfig {
  dialect: DatabaseDialect
  driverFamily: DriverFamily
  url: string
  /** The URL with any password removed. Safe for logs and error messages. */
  safeUrl: string
}

const DIALECTS: readonly DatabaseDialect[] = ["sqlite", "postgresql", "mysql", "mariadb"]

const DRIVER_FAMILY: Record<DatabaseDialect, DriverFamily> = {
  sqlite: "sqlite",
  postgresql: "postgresql",
  mysql: "mysql",
  mariadb: "mysql",
}

/** Schemes each dialect will accept. `postgres://` is the historical alias. */
const ACCEPTED_SCHEMES: Record<DatabaseDialect, readonly string[]> = {
  sqlite: ["file:"],
  postgresql: ["postgresql:", "postgres:"],
  mysql: ["mysql:"],
  mariadb: ["mysql:", "mariadb:"],
}

/**
 * Strip the password from a database URL.
 *
 * Used on every path where a URL could reach a human: startup errors, migration
 * failures, connection failures. Deliberately total — it is called while
 * handling an error, and a redactor that throws would replace a useful message
 * with a confusing one.
 *
 * Unparseable input is not echoed back: a malformed URL is still whatever the
 * operator typed, which may well be a password with a typo in the scheme.
 */
export function redactDatabaseUrl(url: string): string {
  if (typeof url !== "string" || url.trim() === "") return "(unset)"

  try {
    const parsed = new URL(url)
    if (!parsed.password) return url
    parsed.password = "***"
    return parsed.toString()
  } catch {
    // Not parseable. Fall back to a scheme-only description rather than
    // returning the raw string, which may contain credentials.
    const scheme = url.split(":", 1)[0]
    return /^[a-z][a-z0-9+.-]*$/i.test(scheme) ? `${scheme}://(unparseable, redacted)` : "(unparseable, redacted)"
  }
}

/** SQLite in the working directory — the zero-configuration development default. */
export const DEVELOPMENT_DATABASE_URL = "file:data/app.db"

/**
 * `process.env.NEXT_PHASE` while `next build` runs: `PHASE_PRODUCTION_BUILD`
 * from `next/constants`, spelled out so this parser imports nothing from Next.
 * `tests/config/databaseConfig.test.ts` pins the two together.
 */
export const NEXT_BUILD_PHASE = "phase-production-build"

/**
 * The body of `databaseUrlFor`'s production refusal — the message text after
 * `fail()`'s `Invalid database configuration: ` prefix.
 *
 * `scripts/migrate.mjs` cannot import this: it is plain ESM that has to run
 * without a TypeScript loader inside the production container. It carries an
 * IDENTICAL copy of this string, in `assertProductionDatabaseUrl`, and
 * `tests/config/migrateParity.test.ts` pins the two together by calling both
 * functions and comparing the thrown messages — the same duplication-with-a-
 * test pattern `resolveConfig` already uses for the dialect/URL rules.
 *
 * It must name `DATABASE_URL=file:data/app.db` — the former IMPLICIT default,
 * relative to the directory the server starts in — as the upgrade path for a
 * deployment outside the official Docker image, and it must never say
 * `file:/data/app.db`: that is the path the Docker image's own volume uses,
 * and suggesting it to a non-Docker upgrader points them at an empty database.
 */
const PRODUCTION_DATABASE_URL_REQUIRED_MESSAGE =
  "DATABASE_URL is required in production. Without it FlowCMS would open an empty SQLite " +
  "file inside the container, which is deleted — with every post, setting and account in " +
  "it — on the next redeploy. If you are upgrading a deployment outside the official Docker " +
  "image that relied on FlowCMS's former default, set DATABASE_URL=file:data/app.db (the same " +
  "path, relative to the directory the server starts in) to keep using that database. " +
  "Otherwise set DATABASE_URL to postgresql://…, mysql://…, or a SQLite file on persistent " +
  "storage, with DATABASE_DIALECT to match."

/**
 * The URL to connect to: DATABASE_URL, or the development default where that is
 * harmless.
 *
 * Never the default while serving production. There it would be a SQLite file
 * inside the container's writable layer — one that works, passes readiness once
 * migrated, and is deleted with the site's content on the next redeploy. FlowCMS
 * refuses the same trap for uploads (`STORAGE_DRIVER=local` without
 * `LOCAL_STORAGE_PATH`) and for secrets; the database gets the same rule.
 *
 * `next build` is the exception inside production: it evaluates the database
 * client to collect page data, with NODE_ENV=production and — in the Docker
 * builder stage and in CI — no database configured. The file it opens is
 * build-time scratch that no running server ever reads.
 */
export function databaseUrlFor(env: { DATABASE_URL?: string; NODE_ENV?: string; NEXT_PHASE?: string }): string {
  const url = env.DATABASE_URL?.trim() ?? ""
  if (url !== "") return url

  if (env.NODE_ENV === "production" && env.NEXT_PHASE !== NEXT_BUILD_PHASE) {
    fail(PRODUCTION_DATABASE_URL_REQUIRED_MESSAGE)
  }
  return DEVELOPMENT_DATABASE_URL
}

function fail(message: string): never {
  throw new Error(`Invalid database configuration: ${message}`)
}

function schemeOf(url: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim())
  return match ? `${match[1].toLowerCase()}:` : null
}

/**
 * Validate the dialect/URL pair, or throw.
 *
 * Never resolves a contradiction. `DATABASE_DIALECT=postgresql` with a `file:`
 * URL has two readings and no correct guess; picking one would leave an
 * operator convinced they are running PostgreSQL while their content sits in a
 * SQLite file that no backup job knows about.
 */
export function parseDatabaseConfig(env: {
  DATABASE_DIALECT?: string
  DATABASE_URL?: string
}): DatabaseConfig {
  const rawUrl = env.DATABASE_URL?.trim() ?? ""
  if (rawUrl === "") {
    fail("DATABASE_URL is required (for example file:/data/app.db, postgresql://…, mysql://…)")
  }

  const scheme = schemeOf(rawUrl)
  if (!scheme) {
    fail(
      `DATABASE_URL has no scheme — expected one of file:, postgresql:, mysql: ` +
        `(received ${redactDatabaseUrl(rawUrl)})`,
    )
  }

  const rawDialect = env.DATABASE_DIALECT?.trim()

  let dialect: DatabaseDialect
  if (rawDialect === undefined || rawDialect === "") {
    // Only one scheme is unambiguous. `mysql:` could be MySQL or MariaDB, and
    // defaulting would silently choose a product the operator did not pick.
    if (scheme === "file:") {
      dialect = "sqlite"
    } else {
      fail(
        `DATABASE_DIALECT is required for a ${scheme}// URL — set it to one of ` +
          `${DIALECTS.join(", ")}. It cannot be inferred, because MySQL and MariaDB ` +
          `share a URL scheme.`,
      )
    }
  } else {
    if (!(DIALECTS as readonly string[]).includes(rawDialect)) {
      fail(`DATABASE_DIALECT "${rawDialect}" is not supported — expected one of ${DIALECTS.join(", ")}`)
    }
    dialect = rawDialect as DatabaseDialect
  }

  const accepted = ACCEPTED_SCHEMES[dialect]
  if (!accepted.includes(scheme)) {
    fail(
      `DATABASE_DIALECT is "${dialect}" but DATABASE_URL uses "${scheme}//". ` +
        `Expected ${accepted.map((s) => `${s}//`).join(" or ")}. ` +
        `Refusing to guess which one you meant.`,
    )
  }

  return {
    dialect,
    driverFamily: DRIVER_FAMILY[dialect],
    url: rawUrl,
    safeUrl: redactDatabaseUrl(rawUrl),
  }
}
