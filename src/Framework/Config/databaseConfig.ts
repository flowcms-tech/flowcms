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
