/**
 * Storage configuration: the bundled Garage, or any external S3-compatible
 * endpoint.
 *
 * THERE IS NO THIRD OPTION, and its absence is a product decision rather than a
 * gap. FlowCMS serves images through `/api/public/images` and presigned URLs
 * generated server-side; there is no local-filesystem media backend, so an
 * "uploads directory" choice here would configure something the application
 * does not implement.
 *
 * GARAGE IS INFRASTRUCTURE, NOT A MODE. The application talks to
 * `StorageService`, which talks S3, and it cannot tell the difference between
 * Garage and AWS. Nothing in this file branches application behaviour by
 * vendor, and nothing may start doing so: Garage is a Compose service and a set
 * of environment values, which is the whole reason an operator can move off it
 * by editing five variables.
 */

/** Garage's own endpoint on the Docker network. The browser never sees it. */
const GARAGE_ENDPOINT = "http://garage:3900"
const GARAGE_REGION = "garage"
const GARAGE_BUCKET = "flowcms"

export function usesGarage(config) {
  return config.storage === "garage"
}

/**
 * The five variables `StorageService` reads.
 *
 * The exact names the application already uses — no aliases, no installer-only
 * spellings. An operator moving from Garage to R2 changes these values and
 * nothing else.
 */
/** @returns {Record<string, string>} */
export function buildStorageEnv(config) {
  if (config.storage === "garage") {
    return {
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
