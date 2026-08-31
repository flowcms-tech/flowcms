/**
 * Storage configuration: a local directory, the bundled Garage, or any external
 * S3-compatible endpoint.
 *
 * TWO CONCEPTS, KEPT SEPARATE ON PURPOSE.
 *
 *   config.storage   WHAT TO SET UP     garage | s3 | local
 *   STORAGE_DRIVER   WHAT TO RUN        s3 | local
 *
 * They are not the same enum, because Garage and an external provider are
 * different infrastructure running the same driver. `storageDriverFor()` is the
 * only place the mapping lives.
 *
 * GARAGE IS INFRASTRUCTURE, NOT A DRIVER. The application talks to
 * `StorageService`, which dispatches to a driver, and the S3 driver cannot tell
 * Garage from AWS. Nothing in this file branches application behaviour by
 * vendor, and nothing may start doing so: Garage is a Compose service and a set
 * of environment values, which is the whole reason an operator can move off it
 * by editing five variables.
 *
 * The header of this file used to say there was NO third option, because the
 * application had no filesystem backend. Phase 2 gave it one.
 */

/** Garage's own endpoint on the Docker network. The browser never sees it. */
const GARAGE_ENDPOINT = "http://garage:3900"
const GARAGE_REGION = "garage"
const GARAGE_BUCKET = "flowcms"

export function usesGarage(config) {
  return config.storage === "garage"
}

/**
 * Where a Docker install keeps uploads.
 *
 * UNDER `/data`, WHICH IS ALREADY PERSISTENT. `compose.yml` mounts
 * `flowcms-data:/data`, the Dockerfile creates `/data` and chowns it to the
 * unprivileged `flowcms` user, and `VOLUME ["/data"]` is declared. Uploads
 * therefore survive `docker compose up` with no new volume, no new mount and
 * nothing for an operator to remember to back up separately.
 *
 * Anywhere else inside the container is a directory in the container's writable
 * layer, which is destroyed and recreated on the next `up` — and the failure is
 * silent: uploads work, then are simply gone.
 */
export const DOCKER_LOCAL_STORAGE_PATH = "/data/uploads"

/**
 * Where a Local Node install keeps uploads.
 *
 * Project-relative, beside the SQLite database that `data/` already holds. The
 * repository ignores `/data/` (an anchored rule in .gitignore) and `.dockerignore`
 * excludes `data`, so uploads cannot be committed or swept into a build context
 * by accident.
 */
export const LOCAL_NODE_STORAGE_PATH = "./data/uploads"

/**
 * The upload directory for a deployment mode.
 *
 * DERIVED, NEVER PROMPTED. A path typed into an installer is a path that can
 * point outside the container's persistent volume, and that mistake is silent
 * until the first restart. The operator picks Docker or Local Node; the path
 * follows from that, and `LOCAL_STORAGE_PATH` in the generated `.env` is where
 * they change it afterwards if they must.
 */
export function localStoragePathFor(deploymentMode) {
  return deploymentMode === "docker" ? DOCKER_LOCAL_STORAGE_PATH : LOCAL_NODE_STORAGE_PATH
}

/**
 * The runtime driver a storage choice runs on.
 *
 * THE ONE PLACE INFRASTRUCTURE BECOMES A DRIVER. Both S3-shaped choices collapse
 * to the same driver here, which is the whole design: the application never
 * learns whether its bucket is Garage in the next container or Backblaze in
 * another country.
 */
export function storageDriverFor(config) {
  return config.storage === "local" ? "local" : "s3"
}

/**
 * The storage variables the APPLICATION reads.
 *
 * The exact names the application already uses — no aliases, no installer-only
 * spellings. An operator moving from Garage to R2 changes these values and
 * nothing else.
 *
 * ONLY THE RELEVANT ONES ARE WRITTEN. A Local install gets a driver and a path;
 * it does not get five empty `S3_*` lines that read like something the operator
 * forgot to fill in. An S3 install gets no `LOCAL_STORAGE_PATH` naming a
 * directory nothing will ever write to.
 *
 * `STORAGE_DRIVER` is written EXPLICITLY in every case, including the S3 ones.
 * Its absence means "s3" at runtime, but that default exists so that
 * installations predating the variable keep working — it is an upgrade path, not
 * a style. A freshly generated project should state what it is.
 */
/** @returns {Record<string, string>} */
export function buildStorageEnv(config) {
  if (config.storage === "local") {
    return {
      STORAGE_DRIVER: "local",
      LOCAL_STORAGE_PATH: localStoragePathFor(config.deploymentMode),
    }
  }

  if (config.storage === "garage") {
    return {
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: GARAGE_ENDPOINT,
      S3_REGION: GARAGE_REGION,
      S3_BUCKET: GARAGE_BUCKET,
      S3_ACCESS_KEY_ID: config.secrets.garageAccessKeyId,
      S3_SECRET_ACCESS_KEY: config.secrets.garageSecretAccessKey,
    }
  }

  const external = config.externalStorage
  if (!external) return {}

  return {
    STORAGE_DRIVER: "s3",
    S3_ENDPOINT: external.endpoint,
    S3_REGION: external.region,
    S3_BUCKET: external.bucket,
    S3_ACCESS_KEY_ID: external.accessKeyId,
    S3_SECRET_ACCESS_KEY: external.secretAccessKey,
  }
}

/**
 * The variables the GARAGE SERVICE takes.
 *
 * Compose guards these with `:?`, so they must be present or `docker compose
 * up` refuses to start. Garage bootstraps itself from them — `--single-node
 * --default-bucket` creates the bucket and key idempotently, which is why there
 * is no init container and nothing scrapes credentials out of a log.
 *
 * The same key pair appears here and in the app's `S3_*` values because they
 * are the same credential seen from two sides; it is written once in `.env` and
 * referenced by both.
 */
/** @returns {Record<string, string>} */
export function buildGarageServiceEnv(config) {
  if (config.deploymentMode !== "docker" || config.storage !== "garage") return {}
  return {
    GARAGE_BUCKET,
    GARAGE_ACCESS_KEY_ID: config.secrets.garageAccessKeyId,
    GARAGE_SECRET_ACCESS_KEY: config.secrets.garageSecretAccessKey,
  }
}

/**
 * Shape only — never a connection.
 *
 * Probing the endpoint here would be a second implementation of a check
 * `/api/ready` already owns, and the two would eventually disagree about what
 * "configured" means. The installer's job is to write coherent values; deciding
 * whether they work is runtime's.
 */
export function validateExternalStorage(external) {
  const problems = []
  const required = ["endpoint", "region", "bucket", "accessKeyId", "secretAccessKey"]

  for (const field of required) {
    const value = external?.[field]
    if (typeof value !== "string" || value.trim() === "") {
      problems.push(`${field} is required`)
      continue
    }
    // Newlines would break the env file; the serializer refuses them too, but
    // failing here means the operator is told which FIELD rather than which
    // variable.
    if (new RegExp("[\\u0000-\\u001f\\u007f]").test(value)) {
      problems.push(`${field} contains a newline or control character`)
    }
  }

  if (typeof external?.endpoint === "string" && external.endpoint.trim() !== "") {
    try {
      const url = new URL(external.endpoint)
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        problems.push("endpoint must be an http:// or https:// URL")
      }
    } catch {
      // The message never quotes the input: an endpoint can carry credentials
      // in its userinfo, and echoing a rejected value is how it reaches a log.
      problems.push("endpoint is not a valid URL")
    }
  }

  return problems
}

export function describeStorage(config) {
  if (config.storage === "local") {
    // The single-node caveat is stated at the moment the choice is confirmed,
    // not buried in documentation an operator reads after their second replica
    // cannot see the first one's uploads. A local directory is only shared if
    // the operator has made it shared.
    return `Local filesystem, single-node (${localStoragePathFor(config.deploymentMode)})`
  }
  if (config.storage === "garage") return "Garage (bundled, single-node)"
  const host = safeHost(config.externalStorage?.endpoint)
  return host ? `External S3-compatible (${host})` : "External S3-compatible"
}

/**
 * The host of an endpoint, for a summary line.
 *
 * Host only — a URL may carry `user:password@` in its userinfo, and a summary
 * that printed the whole endpoint would print that too.
 */
function safeHost(endpoint) {
  if (!endpoint) return null
  try {
    return new URL(endpoint).host
  } catch {
    return null
  }
}
