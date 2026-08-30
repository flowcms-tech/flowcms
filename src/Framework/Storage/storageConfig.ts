import { getS3Config } from "@/Framework/Settings/SettingsService"
import { StorageConfigurationError } from "./StorageErrors"
import type { StorageDriverName } from "./StorageDriver"

/**
 * WHICH storage backend this deployment runs, and WHERE.
 *
 * The single boundary between "what the operator configured" and "which driver
 * answers a request". `resolveStorageDriver` is its only consumer, so no route,
 * module or component ever branches on the driver — which is the property that
 * keeps the File Manager working unmodified on either backend.
 *
 * ENVIRONMENT-ONLY, DELIBERATELY.
 *
 * `STORAGE_DRIVER` and `LOCAL_STORAGE_PATH` are deployment configuration, like
 * `AUTH_SECRET` and `CAPTCHA_SECRET` — not settings-row values like the S3
 * credentials. That is a product decision, not an implementation shortcut.
 *
 * Putting the driver in the database would make "which storage does this site
 * use" a form field, and a Save button that moves an installation from S3 to a
 * filesystem is a Save button that makes every existing image disappear with no
 * warning and no way back. Changing where files live is a MIGRATION — test the
 * destination, decide whether to copy, verify, then cut over — and that is a
 * later phase's work. Until it exists, the safe thing is for this choice to be
 * settable only where a deliberate redeploy is required.
 *
 * The S3 CREDENTIALS keep their existing settings-row-over-environment
 * behaviour, unchanged, because rotating a credential is not moving a file.
 */

export const STORAGE_DRIVER_ENV = "STORAGE_DRIVER"
export const LOCAL_STORAGE_PATH_ENV = "LOCAL_STORAGE_PATH"

/**
 * The resolved configuration, as a discriminated union.
 *
 * A union rather than one wide object with optional fields: a `local` config
 * has no bucket and an `s3` config has no root, and modelling that with
 * `bucket?: string` would push a non-null assertion into every consumer.
 */
export type ResolvedStorageConfig =
  | {
      driver: "s3"
      endpoint: string | undefined
      region: string | undefined
      bucket: string
      accessKeyId: string
      secretAccessKey: string
    }
  | {
      driver: "local"
      /** Absolute or process-relative; the driver resolves and contains it. */
      root: string
    }

/**
 * Reads `STORAGE_DRIVER`.
 *
 * ABSENT MEANS `s3`, AND THAT IS THE MOST IMPORTANT LINE IN THIS FILE.
 *
 * Every FlowCMS installation in existence predates this variable. If absence
 * resolved to anything else, upgrading would silently repoint a running site at
 * a different backend: no error, no missing configuration, just an admin panel
 * where every image had vanished and a File Manager showing an empty bucket.
 * The default is therefore not a convenience — it is the upgrade path.
 *
 * An UNKNOWN value throws instead of falling back, for the mirror-image reason:
 * the operator asked for something specific, and quietly running a different
 * backend than the one they named is the same failure wearing a different hat.
 */
export function resolveStorageDriverName(env: NodeJS.ProcessEnv = process.env): StorageDriverName {
  const raw = (env[STORAGE_DRIVER_ENV] ?? "").trim().toLowerCase()

  // Empty is the same as absent: `STORAGE_DRIVER=` in a .env file, or a Compose
  // interpolation that expanded to nothing, must not be a third case.
  if (raw === "") return "s3"
  if (raw === "s3" || raw === "local") return raw

  throw new StorageConfigurationError(
    "driver_invalid",
    // `garage` is called out by name because it is the single most likely wrong
    // value: it IS one of the installer's storage choices. It is infrastructure
    // reached through the s3 driver, not a driver of its own — which is exactly
    // why an operator can move from Garage to R2 without FlowCMS noticing.
    `${STORAGE_DRIVER_ENV} must be "s3" or "local" (got "${raw}"). ` +
      `A bundled Garage deployment uses "s3": Garage is an S3-compatible server, not a separate driver.`,
  )
}

/** The active driver's full configuration. */
export async function getStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedStorageConfig> {
  const driver = resolveStorageDriverName(env)

  if (driver === "local") {
    const root = (env[LOCAL_STORAGE_PATH_ENV] ?? "").trim()
    if (root === "") {
      // FAILING CLOSED IS LOAD-BEARING HERE. A default relative path would
      // resolve against the process working directory, which inside the
      // container is `/app` — not the persistent `/data` volume. Uploads would
      // appear to work, survive until the next `docker compose up`, and then be
      // gone, with the operator having seen no warning at any point.
      throw new StorageConfigurationError(
        "local_path_missing",
        `${STORAGE_DRIVER_ENV}=local requires ${LOCAL_STORAGE_PATH_ENV}. ` +
          `In Docker set it under the persistent volume, e.g. /data/uploads.`,
      )
    }
    return { driver: "local", root }
  }

  try {
    return { driver: "s3", ...(await getS3Config()) }
  } catch (error) {
    // ONLY the "not configured" case becomes a configuration problem. A
    // database outage while reading the settings row also surfaces here, and
    // reporting that as "you have not configured S3" would send an operator to
    // the wrong screen in the middle of an incident.
    if (isS3NotConfigured(error)) {
      throw new StorageConfigurationError(
        "s3_incomplete",
        "S3 storage is not fully configured: a bucket, an access key ID and a secret access key are required.",
        { cause: error },
      )
    }
    throw error
  }
}

/**
 * The one remaining place that reads `getS3Config`'s message.
 *
 * It is confined to this function on purpose. `getS3Config` predates typed
 * storage errors and is shared with the admin settings route, so it still
 * throws a plain `Error`; translating it once, here, is what lets readiness and
 * first-run setup branch on `problem` codes instead of on prose.
 */
function isS3NotConfigured(error: unknown): boolean {
  return error instanceof Error && error.message.includes("S3 is not configured")
}

/**
 * A stable identity for WHERE files physically live.
 *
 * Built now, used later. Phase 4 has to tell two superficially similar edits
 * apart:
 *
 *   rotating a credential   same files, same place   -> safe to apply at once
 *   changing bucket/root    different place entirely -> needs a migration
 *
 * Deriving that from a config object is only possible if the config model keeps
 * location and credentials separable, so this function exists in Phase 3 to pin
 * that property with tests before anything depends on it.
 *
 * CREDENTIALS ARE EXCLUDED BY CONSTRUCTION, which is what makes a rotation
 * produce an identical id — and also makes the value safe to log or persist.
 */
export function storageLocationId(config: ResolvedStorageConfig): string {
  if (config.driver === "local") return `local:${config.root}`

  // A trailing slash is cosmetic in an endpoint and must not read as a move.
  const endpoint = (config.endpoint ?? "").replace(/\/+$/, "")
  return `s3:${endpoint}|${config.region ?? ""}|${config.bucket}`
}
