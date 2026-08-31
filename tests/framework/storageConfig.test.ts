import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  StorageConfigurationError,
  type StorageConfigProblem,
} from "@/Framework/Storage/StorageErrors"

/**
 * Which backend a deployment runs, and where.
 *
 * `STORAGE_DRIVER` and `LOCAL_STORAGE_PATH` are ENVIRONMENT-ONLY, like
 * `AUTH_SECRET` and `CAPTCHA_SECRET` and unlike the S3 credentials. That is a
 * deliberate product decision rather than an implementation shortcut: putting
 * the driver in the settings row would make "which storage does this site use"
 * editable from a browser, and a Save button that moves an installation from S3
 * to a filesystem — leaving every existing image behind — is precisely the
 * footgun this work exists to remove. Changing storage is a migration, and
 * migration is a later phase.
 */

const getS3Config = vi.fn()
vi.mock("@/Framework/Settings/SettingsService", () => ({
  getS3Config: () => getS3Config(),
}))

const { getEnvironmentStorageConfig, resolveStorageDriverName, storageLocationId, LOCAL_STORAGE_PATH_ENV, STORAGE_DRIVER_ENV } =
  await import("@/Framework/Storage/storageConfig")

const S3_CONFIG = {
  endpoint: "https://s3.example.com",
  region: "us-east-1",
  bucket: "flowcms",
  accessKeyId: "AKIA",
  secretAccessKey: "secret",
}

beforeEach(() => {
  getS3Config.mockReset().mockResolvedValue({ ...S3_CONFIG })
})

/** A bare environment, so nothing leaks in from the real process. */
function env(overrides: Record<string, string | undefined> = {}) {
  return { ...overrides } as NodeJS.ProcessEnv
}

async function problemOf(promise: Promise<unknown>): Promise<StorageConfigProblem> {
  try {
    await promise
  } catch (error) {
    if (error instanceof StorageConfigurationError) return error.problem
    throw error
  }
  throw new Error("expected a StorageConfigurationError, but the call succeeded")
}

describe("choosing the driver", () => {
  it("defaults to s3 when STORAGE_DRIVER is absent", () => {
    // BACKWARD COMPATIBILITY, AND THE MOST IMPORTANT TEST IN THIS FILE.
    // Every FlowCMS installation that exists today has no STORAGE_DRIVER. If
    // absence resolved to `local`, upgrading would silently point a running
    // site at an empty directory: no error, no missing configuration, just an
    // admin panel where every existing image has vanished.
    expect(resolveStorageDriverName(env())).toBe("s3")
  })

  it("treats an empty STORAGE_DRIVER as absent", () => {
    // `STORAGE_DRIVER=` in a .env file, or a Compose default that expanded to
    // nothing, must not be a different case from omitting the line.
    expect(resolveStorageDriverName(env({ STORAGE_DRIVER: "" }))).toBe("s3")
    expect(resolveStorageDriverName(env({ STORAGE_DRIVER: "   " }))).toBe("s3")
  })

  it("honours an explicit s3", () => {
    expect(resolveStorageDriverName(env({ STORAGE_DRIVER: "s3" }))).toBe("s3")
  })

  it("honours an explicit local", () => {
    expect(resolveStorageDriverName(env({ STORAGE_DRIVER: "local" }))).toBe("local")
  })

  it("accepts surrounding whitespace and any casing", () => {
    expect(resolveStorageDriverName(env({ STORAGE_DRIVER: " Local " }))).toBe("local")
    expect(resolveStorageDriverName(env({ STORAGE_DRIVER: "S3" }))).toBe("s3")
  })

  it("refuses an unknown value rather than falling back", () => {
    // Falling back to s3 here would be the same class of bug as defaulting to
    // local: the operator asked for something specific, and quietly running a
    // different backend is worse than refusing to start.
    expect(() => resolveStorageDriverName(env({ STORAGE_DRIVER: "garage" }))).toThrow(
      StorageConfigurationError,
    )
    expect(() => resolveStorageDriverName(env({ STORAGE_DRIVER: "filesystem" }))).toThrow(
      StorageConfigurationError,
    )
  })

  it("names garage explicitly as not being a driver", () => {
    // The single most likely wrong value, because `garage` IS one of the
    // installer's storage choices — it is just infrastructure reached through
    // the s3 driver, not a driver of its own.
    let message = ""
    try {
      resolveStorageDriverName(env({ STORAGE_DRIVER: "garage" }))
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/garage/i)
    expect(message).toMatch(/s3/i)
  })

  it("reports an invalid driver as its own problem code", () => {
    try {
      resolveStorageDriverName(env({ STORAGE_DRIVER: "nope" }))
    } catch (error) {
      expect((error as StorageConfigurationError).problem).toBe("driver_invalid")
    }
  })
})

describe("resolving the s3 configuration", () => {
  it("returns the settings-over-environment values unchanged", async () => {
    const config = await getEnvironmentStorageConfig(env({ STORAGE_DRIVER: "s3" }))

    expect(config).toEqual({ driver: "s3", ...S3_CONFIG })
  })

  it("resolves s3 by default, exactly as an existing installation does", async () => {
    const config = await getEnvironmentStorageConfig(env())

    expect(config.driver).toBe("s3")
    expect(getS3Config).toHaveBeenCalled()
  })

  it("reports incomplete s3 configuration as a typed problem", async () => {
    getS3Config.mockRejectedValue(new Error("S3 is not configured — set it in Admin"))

    expect(await problemOf(getEnvironmentStorageConfig(env({ STORAGE_DRIVER: "s3" })))).toBe("s3_incomplete")
  })

  it("does not disguise an unrelated failure as a configuration problem", async () => {
    // A database outage while reading the settings row is not "you have not
    // configured S3", and reporting it that way sends an operator to the wrong
    // screen during an incident.
    getS3Config.mockRejectedValue(new Error("SQLITE_BUSY: database is locked"))

    await expect(getEnvironmentStorageConfig(env({ STORAGE_DRIVER: "s3" }))).rejects.toThrow("SQLITE_BUSY")
  })
})

describe("resolving the local configuration", () => {
  it("returns the configured root", async () => {
    const config = await getEnvironmentStorageConfig(
      env({ STORAGE_DRIVER: "local", LOCAL_STORAGE_PATH: "/data/uploads" }),
    )

    expect(config).toEqual({ driver: "local", root: "/data/uploads" })
  })

  it("never consults the s3 settings for a local deployment", async () => {
    // A Local installation has no S3 credentials and must never be reported as
    // an S3 configuration failure.
    getS3Config.mockRejectedValue(new Error("S3 is not configured"))

    const config = await getEnvironmentStorageConfig(
      env({ STORAGE_DRIVER: "local", LOCAL_STORAGE_PATH: "/data/uploads" }),
    )

    expect(config.driver).toBe("local")
    expect(getS3Config).not.toHaveBeenCalled()
  })

  it("refuses to guess a root when LOCAL_STORAGE_PATH is missing", async () => {
    // FAILING CLOSED IS LOAD-BEARING. A default relative path would resolve
    // against the process working directory, which inside the container is
    // `/app` — not the persistent `/data` volume. Uploads would work, survive
    // until the next `docker compose up`, and then be gone.
    expect(await problemOf(getEnvironmentStorageConfig(env({ STORAGE_DRIVER: "local" })))).toBe(
      "local_path_missing",
    )
  })

  it("treats a blank LOCAL_STORAGE_PATH as missing", async () => {
    expect(
      await problemOf(getEnvironmentStorageConfig(env({ STORAGE_DRIVER: "local", LOCAL_STORAGE_PATH: "  " }))),
    ).toBe("local_path_missing")
  })

  it("names the variable to set, so the message is actionable", async () => {
    let message = ""
    try {
      await getEnvironmentStorageConfig(env({ STORAGE_DRIVER: "local" }))
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain(LOCAL_STORAGE_PATH_ENV)
  })

  it("trims the configured root", async () => {
    const config = await getEnvironmentStorageConfig(
      env({ STORAGE_DRIVER: "local", LOCAL_STORAGE_PATH: " /data/uploads " }),
    )
    expect(config).toEqual({ driver: "local", root: "/data/uploads" })
  })
})

describe("the environment variable names are pinned", () => {
  it("uses the documented names", () => {
    // These appear in .env.example, in generated projects, and in operator
    // runbooks. Renaming one silently reverts every deployment to the default.
    expect(STORAGE_DRIVER_ENV).toBe("STORAGE_DRIVER")
    expect(LOCAL_STORAGE_PATH_ENV).toBe("LOCAL_STORAGE_PATH")
  })
})

describe("storage location identity", () => {
  /**
   * Phase 4 has to tell a CREDENTIAL ROTATION apart from a RELOCATION: the
   * first is safe to apply immediately, the second moves where every file
   * lives and requires migration. This function is the thing that
   * distinguishes them, and it is built now so Phase 3's configuration model
   * cannot accidentally make the distinction impossible.
   */
  it("ignores credentials, so a rotation keeps the same identity", () => {
    const before = storageLocationId({ driver: "s3", ...S3_CONFIG })
    const after = storageLocationId({
      driver: "s3",
      ...S3_CONFIG,
      accessKeyId: "AKIA-NEW",
      secretAccessKey: "rotated",
    })

    expect(after).toBe(before)
  })

  it("changes when the bucket changes", () => {
    expect(storageLocationId({ driver: "s3", ...S3_CONFIG, bucket: "other" })).not.toBe(
      storageLocationId({ driver: "s3", ...S3_CONFIG }),
    )
  })

  it("changes when the endpoint changes", () => {
    expect(
      storageLocationId({ driver: "s3", ...S3_CONFIG, endpoint: "https://r2.example.com" }),
    ).not.toBe(storageLocationId({ driver: "s3", ...S3_CONFIG }))
  })

  it("changes when the region changes", () => {
    expect(storageLocationId({ driver: "s3", ...S3_CONFIG, region: "eu-west-1" })).not.toBe(
      storageLocationId({ driver: "s3", ...S3_CONFIG }),
    )
  })

  it("ignores a trailing slash on the endpoint", () => {
    expect(
      storageLocationId({ driver: "s3", ...S3_CONFIG, endpoint: "https://s3.example.com/" }),
    ).toBe(storageLocationId({ driver: "s3", ...S3_CONFIG }))
  })

  it("distinguishes one local root from another", () => {
    expect(storageLocationId({ driver: "local", root: "/data/uploads" })).not.toBe(
      storageLocationId({ driver: "local", root: "/srv/uploads" }),
    )
  })

  it("never equates a local root with an s3 bucket", () => {
    expect(storageLocationId({ driver: "local", root: "/flowcms" })).not.toBe(
      storageLocationId({ driver: "s3", ...S3_CONFIG, bucket: "flowcms" }),
    )
  })

  it("carries no secret, so it is safe to log or store", () => {
    const id = storageLocationId({ driver: "s3", ...S3_CONFIG })

    expect(id).not.toContain(S3_CONFIG.secretAccessKey)
    expect(id).not.toContain(S3_CONFIG.accessKeyId)
  })
})
