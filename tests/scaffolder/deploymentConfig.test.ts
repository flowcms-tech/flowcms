import { describe, expect, it } from "vitest"
import {
  DATABASES,
  DEPLOYMENT_MODES,
  PACKAGE_MANAGERS,
  REDIS_MODES,
  STORAGE_MODES,
  DEFAULTS,
  defaultsFor,
} from "../../packages/create-flowcms/src/config/model.mjs"
import {
  ConfigError,
  applyDefaults,
  buildSafeSummary,
  formatSummary,
  validateConfig,
} from "../../packages/create-flowcms/src/config/validate.mjs"
import { generateSecrets } from "../../packages/create-flowcms/src/config/secrets.mjs"
import {
  buildDatabaseEnv,
  buildDatabaseServiceEnv,
  sqliteUrlFor,
} from "../../packages/create-flowcms/src/config/database.mjs"
import {
  buildGarageServiceEnv,
  buildStorageEnv,
  validateExternalStorage,
} from "../../packages/create-flowcms/src/config/storage.mjs"
import { buildRedisEnv, redisProfileFor } from "../../packages/create-flowcms/src/config/redis.mjs"

/**
 * THE DEPLOYMENT CONFIGURATION MODEL.
 *
 * Everything here is a pure function of a configuration object, which is the
 * whole reason the phase separated collecting answers from rendering files:
 * these assertions need no terminal, no filesystem, no package manager and no
 * network.
 *
 * The rules being pinned are the ones with a consequence an operator would
 * discover late — an engine inferred from a URL, a Compose hostname written
 * into a local deployment, a secret reused for two purposes.
 */

/** A complete, valid configuration to vary one field of at a time. */
function baseConfig(overrides: Record<string, unknown> = {}) {
  const partial = applyDefaults({ projectName: "my-site", ...overrides })
  return { ...partial, secrets: generateSecrets(partial) }
}

describe("the enums", () => {
  it("offers exactly four databases", () => {
    expect(DATABASES).toEqual(["sqlite", "postgresql", "mysql", "mariadb"])
  })

  it("keeps MariaDB as its own choice, not an alias of MySQL", () => {
    // They run different images, take differently-named variables and report a
    // different dialect. Collapsing them in the UI would present a lie about
    // what gets deployed.
    expect(DATABASES).toContain("mysql")
    expect(DATABASES).toContain("mariadb")
  })

  it("offers exactly two storage modes, and no local filesystem", () => {
    // FlowCMS has no local media backend. A third option here would configure
    // something the application does not implement.
    expect(STORAGE_MODES).toEqual(["garage", "s3"])
    expect(STORAGE_MODES).not.toContain("local")
    expect(STORAGE_MODES).not.toContain("filesystem")
  })

  it("offers two deployment modes and four package managers", () => {
    expect(DEPLOYMENT_MODES).toEqual(["docker", "local"])
    expect(PACKAGE_MANAGERS).toEqual(["npm", "pnpm", "yarn", "bun"])
  })

  it("keeps Redis optional", () => {
    expect(REDIS_MODES).toContain("none")
  })
})

describe("defaults", () => {
  it("are the choices the product has already made", () => {
    expect(DEFAULTS.packageManager).toBe("npm")
    expect(DEFAULTS.database).toBe("sqlite")
    expect(DEFAULTS.redis).toBe("none")
    expect(DEFAULTS.adminPath).toBe("/admin")
    expect(DEFAULTS.deploymentMode).toBe("docker")
  })

  it("do not default storage to Garage outside Docker", () => {
    // Garage is a Compose service. Defaulting to it locally would produce a
    // configuration that cannot work and that nobody chose.
    expect(defaultsFor("docker").storage).toBe("garage")
    expect(defaultsFor("local").storage).toBe("s3")
  })

  it("fill in only what was not answered", () => {
    const filled = applyDefaults({ database: "postgresql", adminPath: "/control" })
    expect(filled.database).toBe("postgresql")
    expect(filled.adminPath).toBe("/control")
    expect(filled.packageManager).toBe("npm")
  })
})

describe("validation refuses what cannot work", () => {
  it("accepts a plain default configuration", () => {
    expect(() => validateConfig(baseConfig())).not.toThrow()
  })

  it.each([
    ["deploymentMode", "kubernetes"],
    ["packageManager", "cargo"],
    ["database", "oracle"],
    ["storage", "local"],
    ["redis", "memcached"],
  ])("rejects an invented %s", (field, value) => {
    expect(() => validateConfig(baseConfig({ [field]: value }))).toThrow(ConfigError)
  })

  it("refuses Garage outside Docker, and says why", () => {
    // The combination each field permits and the pair does not.
    expect(() => validateConfig(baseConfig({ deploymentMode: "local", storage: "garage" }))).toThrow(
      /Garage is a Docker Compose service/,
    )
  })

  it("refuses the bundled Redis outside Docker", () => {
    expect(() => validateConfig(baseConfig({ deploymentMode: "local", redis: "bundled" }))).toThrow(
      /bundled Redis is a Docker Compose service/,
    )
  })

  it("refuses an external Redis with no URL", () => {
    expect(() => validateConfig(baseConfig({ redis: "external" }))).toThrow(/needs a URL/)
  })

  it("refuses an external database URL for SQLite", () => {
    expect(() =>
      validateConfig(baseConfig({ database: "sqlite", externalDatabaseUrl: "postgres://x/y" })),
    ).toThrow(/SQLite is a file/)
  })

  it("reports every problem at once, not the first", () => {
    // Three mistakes should cost one run, not three.
    try {
      validateConfig(baseConfig({ database: "oracle", storage: "local", redis: "memcached" }))
      throw new Error("expected the configuration to be refused")
    } catch (error) {
      expect((error as ConfigError).problems.length).toBeGreaterThanOrEqual(3)
    }
  })

  it("never quotes a rejected database URL", () => {
    // A database URL carries its password in the userinfo. An error message
    // that echoed it would put it in a terminal and a support ticket.
    const url = "postgresql://user:hunter2@db.example.com:5432/site\nEXTRA=1"
    try {
      validateConfig(baseConfig({ database: "postgresql", externalDatabaseUrl: url }))
      throw new Error("expected the configuration to be refused")
    } catch (error) {
      expect((error as Error).message).not.toContain("hunter2")
      expect((error as Error).message).toMatch(/newline or control character/)
    }
  })

  it("normalizes the admin path it accepts", () => {
    expect(validateConfig(baseConfig({ adminPath: "control/" })).adminPath).toBe("/control")
  })
})

/**
 * THE URL THAT NEVER ARRIVED.
 *
 * A local deployment of a server database has no Compose service for the
 * installer to create, so the connection URL is the operator's to supply.
 * `missingSecrets()` refuses a non-interactive run without one — but the
 * INTERACTIVE path could reach validation with an empty string, because a
 * masked prompt returns `""` for a bare enter and `""` is falsy in every check
 * that asked `if (config.externalDatabaseUrl)`.
 *
 * What that produced, verified against the published 0.1.0 before this rule
 * existed: validation passed, `buildDatabaseEnv` took the MANAGED branch —
 * whose password is null outside Docker — and wrote
 *
 *     DATABASE_URL=postgresql://flowcms:null@localhost:5432/flowcms
 *
 * into somebody's `.env`, silently. A refused configuration costs a retype.
 * That URL costs an evening.
 */
describe("a local deployment whose external database URL never arrived", () => {
  /** Local mode defaults to external S3, which needs credentials of its own. */
  const localExternal = (overrides: Record<string, unknown> = {}) =>
    baseConfig({
      deploymentMode: "local",
      storage: "s3",
      externalStorage: {
        endpoint: "https://s3.example.test",
        region: "eu-west-2",
        bucket: "my-bucket",
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "a-secret",
      },
      ...overrides,
    })

  it.each(["postgresql", "mysql", "mariadb"])(
    "refuses local + %s with an empty URL",
    (database) => {
      expect(() =>
        validateConfig(localExternal({ database, externalDatabaseUrl: "" })),
      ).toThrow(/database URL/i)
    },
  )

  it("refuses local + postgresql with no URL at all", () => {
    expect(() =>
      validateConfig(localExternal({ database: "postgresql", externalDatabaseUrl: null })),
    ).toThrow(ConfigError)
  })

  it("never lets a null password reach a generated DATABASE_URL", () => {
    // The assertion is on the OUTCOME rather than the message: whatever the
    // wording becomes, a configuration that would render this string must not
    // be one `validateConfig` returns.
    const config = localExternal({ database: "postgresql", externalDatabaseUrl: "" })
    expect(buildDatabaseEnv(config).DATABASE_URL).toContain(":null@")
    expect(() => validateConfig(config)).toThrow(ConfigError)
  })

  it("still accepts a real URL", () => {
    expect(() =>
      validateConfig(
        localExternal({
          database: "postgresql",
          externalDatabaseUrl: "postgresql://u:p@db.example.test:5432/flowcms",
        }),
      ),
    ).not.toThrow()
  })

  it("does not require a URL for SQLite, which has no server", () => {
    expect(() =>
      validateConfig(localExternal({ database: "sqlite", externalDatabaseUrl: null })),
    ).not.toThrow()
  })

  it("does not require a URL in Docker, where the installer creates the server", () => {
    expect(() =>
      validateConfig(baseConfig({ database: "postgresql", externalDatabaseUrl: null })),
    ).not.toThrow()
  })
})

describe("secrets", () => {
  it("generates four independent values", () => {
    // One value reused would be a single key unlocking sessions, the CAPTCHA,
    // setup and previews at once — and rotating any would rotate all four.
    const secrets = generateSecrets(applyDefaults({}))
    const values = [
      secrets.authSecret,
      secrets.captchaSecret,
      secrets.setupToken,
      secrets.previewSecret,
    ]
    expect(new Set(values).size).toBe(4)
    for (const value of values) expect(value.length).toBeGreaterThanOrEqual(43)
  })

  it("generates database credentials only for a managed Docker database", () => {
    expect(generateSecrets(applyDefaults({ database: "sqlite" })).databasePassword).toBeNull()
    expect(
      generateSecrets(applyDefaults({ deploymentMode: "local", database: "postgresql" }))
        .databasePassword,
    ).toBeNull()
    expect(
      generateSecrets(applyDefaults({ database: "postgresql" })).databasePassword,
    ).toBeTruthy()
  })

  it("generates a separate root password for MySQL and MariaDB", () => {
    // The image demands one even though FlowCMS never uses the root account.
    // Separate from the application's password so one leaking is not both.
    const secrets = generateSecrets(applyDefaults({ database: "mysql" }))
    expect(secrets.databaseRootPassword).toBeTruthy()
    expect(secrets.databaseRootPassword).not.toBe(secrets.databasePassword)
  })

  it("generates Garage credentials only when Garage is selected", () => {
    expect(generateSecrets(applyDefaults({ storage: "garage" })).garageSecretAccessKey).toBeTruthy()
    expect(
      generateSecrets(applyDefaults({ deploymentMode: "local", storage: "s3" }))
        .garageSecretAccessKey,
    ).toBeNull()
  })

  it("refuses a configuration whose secrets are not independent", () => {
    const config = baseConfig()
    const reused = { ...config, secrets: { ...config.secrets, captchaSecret: config.secrets.authSecret } }
    expect(() => validateConfig(reused)).toThrow(/independent/)
  })
})

describe("database configuration", () => {
  it("always writes an explicit dialect", () => {
    // Phase 5: the engine is never inferred from the URL. MariaDB and MySQL
    // share a scheme, so inference would run one engine's SQL against the other.
    for (const database of DATABASES) {
      const config = baseConfig({
        database,
        ...(database === "sqlite" ? {} : {}),
      })
      expect(buildDatabaseEnv(config).DATABASE_DIALECT).toBe(database)
    }
  })

  it("gives SQLite a volume path in Docker and a project path locally", () => {
    expect(sqliteUrlFor("docker")).toBe("file:/data/app.db")
    expect(sqliteUrlFor("local")).toBe("file:data/app.db")
  })

  it("uses the Compose service name as the host in Docker", () => {
    const env = buildDatabaseEnv(baseConfig({ database: "postgresql" }))
    expect(env.DATABASE_URL).toContain("@postgres:5432/")
    expect(env.DATABASE_URL).not.toContain("localhost")
  })

  it("uses the MySQL wire scheme for MariaDB while keeping the mariadb dialect", () => {
    const env = buildDatabaseEnv(baseConfig({ database: "mariadb" }))
    expect(env.DATABASE_DIALECT).toBe("mariadb")
    expect(env.DATABASE_URL.startsWith("mysql://")).toBe(true)
  })

  it("preserves an external URL verbatim rather than rebuilding it", () => {
    // Taking a URL apart to reassemble it is how a password containing `@` or
    // `/` gets corrupted by an installer trying to help.
    const url = "postgresql://u:p%2Fw%40rd@db.internal:6543/flowcms?sslmode=require"
    const env = buildDatabaseEnv(
      baseConfig({ deploymentMode: "local", database: "postgresql", externalDatabaseUrl: url, storage: "s3" }),
    )
    expect(env.DATABASE_URL).toBe(url)
  })

  it("percent-encodes a generated password into the URL", () => {
    const env = buildDatabaseEnv(baseConfig({ database: "postgresql" }))
    expect(() => new URL(env.DATABASE_URL)).not.toThrow()
  })

  it("writes service credentials only for a managed Docker database", () => {
    expect(buildDatabaseServiceEnv(baseConfig({ database: "sqlite" }))).toEqual({})
    const postgres = buildDatabaseServiceEnv(baseConfig({ database: "postgresql" }))
    expect(Object.keys(postgres).sort()).toEqual(["POSTGRES_DB", "POSTGRES_PASSWORD", "POSTGRES_USER"])
  })

  it("uses no predictable password", () => {
    const postgres = buildDatabaseServiceEnv(baseConfig({ database: "postgresql" }))
    for (const forbidden of ["flowcms", "password", "changeme", "root", "postgres"]) {
      expect(postgres.POSTGRES_PASSWORD).not.toBe(forbidden)
    }
    expect(postgres.POSTGRES_PASSWORD.length).toBeGreaterThanOrEqual(43)
  })

  it("names the MySQL and MariaDB variables their own images use", () => {
    expect(Object.keys(buildDatabaseServiceEnv(baseConfig({ database: "mysql" })))).toContain(
      "MYSQL_ROOT_PASSWORD",
    )
    expect(Object.keys(buildDatabaseServiceEnv(baseConfig({ database: "mariadb" })))).toContain(
      "MARIADB_ROOT_PASSWORD",
    )
  })
})

describe("storage configuration", () => {
  it("points Garage at the Compose service over the Docker network", () => {
    const env = buildStorageEnv(baseConfig({ storage: "garage" }))
    expect(env.S3_ENDPOINT).toBe("http://garage:3900")
    expect(env.S3_BUCKET).toBe("flowcms")
    expect(env.S3_SECRET_ACCESS_KEY).toBeTruthy()
  })

  it("uses the application's own variable names, with no aliases", () => {
    const env = buildStorageEnv(baseConfig({ storage: "garage" }))
    expect(Object.keys(env).sort()).toEqual([
      "S3_ACCESS_KEY_ID",
      "S3_BUCKET",
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_SECRET_ACCESS_KEY",
    ])
  })

  it("passes external credentials through unchanged", () => {
    const external = {
      endpoint: "https://s3.eu-central-003.backblazeb2.com",
      region: "eu-central-003",
      bucket: "my-bucket",
      accessKeyId: "keyid",
      secretAccessKey: "secret",
    }
    const env = buildStorageEnv(baseConfig({ deploymentMode: "local", storage: "s3", externalStorage: external }))
    expect(env.S3_ENDPOINT).toBe(external.endpoint)
    expect(env.S3_SECRET_ACCESS_KEY).toBe(external.secretAccessKey)
  })

  it("writes Garage service credentials only in Docker Garage mode", () => {
    expect(Object.keys(buildGarageServiceEnv(baseConfig({ storage: "garage" })))).toContain(
      "GARAGE_SECRET_ACCESS_KEY",
    )
    expect(
      buildGarageServiceEnv(baseConfig({ deploymentMode: "local", storage: "s3" })),
    ).toEqual({})
  })

  it("validates shape without connecting", () => {
    expect(validateExternalStorage({})).toEqual(expect.arrayContaining([expect.stringMatching(/required/)]))
    expect(
      validateExternalStorage({
        endpoint: "not-a-url",
        region: "r",
        bucket: "b",
        accessKeyId: "k",
        secretAccessKey: "s",
      }),
    ).toContain("endpoint is not a valid URL")
  })

  it("rejects a credential containing a newline", () => {
    const problems = validateExternalStorage({
      endpoint: "https://example.com",
      region: "r",
      bucket: "b",
      accessKeyId: "k",
      secretAccessKey: "s\nINJECTED=1",
    })
    expect(problems).toContain("secretAccessKey contains a newline or control character")
  })
})

describe("redis configuration", () => {
  it("writes nothing at all when disabled", () => {
    // Not `REDIS_URL=`. Empty and absent mean the same thing to the
    // application, and an empty assignment reads like a setting somebody
    // cleared rather than a choice nobody made.
    expect(buildRedisEnv(baseConfig({ redis: "none" }))).toEqual({})
  })

  it("points the bundled service at the Docker network", () => {
    expect(buildRedisEnv(baseConfig({ redis: "bundled" })).REDIS_URL).toBe("redis://redis:6379")
  })

  it("passes an external URL through", () => {
    const url = "rediss://user:pw@cache.example.com:6380"
    expect(buildRedisEnv(baseConfig({ redis: "external", redisUrl: url })).REDIS_URL).toBe(url)
  })

  it("activates the compose profile only for the bundled service", () => {
    expect(redisProfileFor(baseConfig({ redis: "bundled" }))).toBe("redis")
    expect(redisProfileFor(baseConfig({ redis: "none" }))).toBeNull()
    expect(
      redisProfileFor(baseConfig({ deploymentMode: "local", redis: "external", redisUrl: "redis://x:6379", storage: "s3" })),
    ).toBeNull()
  })
})

describe("the safe summary", () => {
  it("shows the choices an operator made", () => {
    const rows = buildSafeSummary(baseConfig({ database: "postgresql", adminPath: "/control" }))
    const text = formatSummary(rows)
    expect(text).toMatch(/PostgreSQL/)
    expect(text).toMatch(/\/control/)
    expect(text).toMatch(/Docker Compose/)
  })

  it("says secrets exist without showing one", () => {
    const config = baseConfig({ database: "postgresql" })
    const text = formatSummary(buildSafeSummary(config))

    expect(text).toMatch(/Secrets\s+Generated/)
    for (const secret of [
      config.secrets.authSecret,
      config.secrets.captchaSecret,
      config.secrets.setupToken,
      config.secrets.previewSecret,
      config.secrets.databasePassword,
      config.secrets.garageAccessKeyId,
      config.secrets.garageSecretAccessKey,
    ].filter(Boolean)) {
      expect(text).not.toContain(secret)
    }
  })

  it("shows only the host of an external endpoint, never its userinfo", () => {
    // A URL can carry `user:password@`, and a summary that printed the whole
    // endpoint would print that too.
    const config = baseConfig({
      deploymentMode: "local",
      storage: "s3",
      externalStorage: {
        endpoint: "https://key:secret@s3.example.com",
        region: "r",
        bucket: "b",
        accessKeyId: "k",
        secretAccessKey: "s",
      },
    })
    const text = formatSummary(buildSafeSummary(config))
    expect(text).toContain("s3.example.com")
    expect(text).not.toContain("secret@")
  })

  it("cannot show a field nobody whitelisted", () => {
    // The property that makes redaction structural: a future secret added to
    // the config is invisible by default rather than needing to be remembered.
    const config = { ...baseConfig(), somethingNew: "SHOULD-NOT-APPEAR" }
    expect(formatSummary(buildSafeSummary(config))).not.toContain("SHOULD-NOT-APPEAR")
  })
})
