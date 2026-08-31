import { LOCAL_STORAGE_PATH_ENV } from "../storageConfig"
import type { ResolvedStorageConfig } from "../storageConfig"

/**
 * TURNING WHAT AN OPERATOR TYPED INTO A MIGRATION DESTINATION.
 *
 * Everything an admin submits passes through here before it becomes a
 * destination, and everything a destination says about itself passes through
 * here before it reaches a screen. Two rules, both security properties rather
 * than presentation choices:
 *
 * A BROWSER MAY NOT NAME A FILESYSTEM PATH. An S3 destination is five fields an
 * admin types, because they identify a remote service that authenticates them
 * anyway. A Local destination is ONE value the deployment chose, taken from
 * `LOCAL_STORAGE_PATH` and never from the request. If a request could carry a
 * root, an admin session would become a write primitive anywhere the process
 * can reach — `/etc`, a bind-mounted host directory, another container's
 * volume — and "migrate storage" would be a way to scatter the site's media
 * across the filesystem. The submitted field is not validated against a list of
 * allowed roots; it is DISCARDED.
 *
 * NOTHING THAT REACHES A SCREEN CARRIES A CREDENTIAL. An S3 endpoint can carry
 * `user:password@` in its userinfo, and every endpoint on this path ends up in
 * an API response, a React tree, a log line and probably a support ticket. So
 * the description of a location is built here rather than assembled by each
 * caller, and it structurally has no field a secret could sit in.
 */

export type MigrationDestinationProblem =
  | "local_not_configured"
  | "bucket_required"
  | "credentials_required"
  | "endpoint_invalid"
  | "driver_invalid"

export class MigrationDestinationError extends Error {
  readonly problem: MigrationDestinationProblem

  constructor(problem: MigrationDestinationProblem, message: string) {
    super(message)
    this.name = "MigrationDestinationError"
    this.problem = problem
  }
}

/**
 * An endpoint with any userinfo removed.
 *
 * `https://key:secret@s3.example.com` -> `https://***@s3.example.com`.
 *
 * The marker is kept rather than dropped so an operator can see that their
 * endpoint contains embedded credentials — which is worth knowing, and is
 * invisible if the userinfo is silently deleted.
 *
 * AN UNPARSEABLE ENDPOINT IS NOT ECHOED. Returning the raw string when the URL
 * parser gives up is exactly the wrong default: whatever made it unparseable
 * has no bearing on whether it contains a secret.
 */
export function redactEndpoint(endpoint: string | null | undefined): string {
  const raw = (endpoint ?? "").trim()
  if (raw === "") return ""

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return "(unreadable endpoint)"
  }

  if (!url.username && !url.password) return raw

  const port = url.port ? `:${url.port}` : ""
  return `${url.protocol}//***@${url.hostname}${port}${url.pathname === "/" ? "" : url.pathname}`
}

/** A location as an operator may see it. Has no field a credential fits in. */
export interface LocationDescription {
  driver: "s3" | "local"
  /** Local only. Deployment configuration, shown read-only. */
  root?: string
  /** S3 only, already redacted. */
  endpoint?: string
  region?: string
  bucket?: string
  /** One line, for a summary row. */
  label: string
}

export function describeLocation(config: ResolvedStorageConfig): LocationDescription {
  if (config.driver === "local") {
    return {
      driver: "local",
      root: config.root,
      label: `Local filesystem — ${config.root}`,
    }
  }

  const endpoint = redactEndpoint(config.endpoint)
  return {
    driver: "s3",
    endpoint,
    region: config.region ?? "",
    bucket: config.bucket,
    label: `S3-compatible — ${config.bucket}${endpoint ? ` at ${endpoint}` : ""}`,
  }
}

/**
 * Describes a location from the flat columns a persisted job stores.
 *
 * Separate from `describeLocation` because a job row is not a
 * `ResolvedStorageConfig` and reconstructing one just to describe it would mean
 * carrying the credentials through a display path for no reason.
 */
export function describeStoredLocation(stored: {
  driver: string
  endpoint?: string | null
  region?: string | null
  bucket?: string | null
  root?: string | null
}): LocationDescription {
  if (stored.driver === "local") {
    const root = stored.root ?? ""
    return { driver: "local", root, label: `Local filesystem — ${root}` }
  }

  const endpoint = redactEndpoint(stored.endpoint)
  const bucket = stored.bucket ?? ""
  return {
    driver: "s3",
    endpoint,
    region: stored.region ?? "",
    bucket,
    label: `S3-compatible — ${bucket}${endpoint ? ` at ${endpoint}` : ""}`,
  }
}

export type LocalDestinationCandidate =
  | { available: true; root: string }
  | { available: false; reason: string }

/**
 * The Local destination this deployment offers, if any.
 *
 * Read from `LOCAL_STORAGE_PATH` REGARDLESS of `STORAGE_DRIVER`. Setting the
 * path while still running on S3 is precisely how an operator prepares an
 * S3 -> Local move; requiring `STORAGE_DRIVER=local` first would mean
 * restarting into a backend that has none of their files in it.
 */
export function resolveLocalDestinationCandidate(
  env: NodeJS.ProcessEnv = process.env,
): LocalDestinationCandidate {
  const root = (env[LOCAL_STORAGE_PATH_ENV] ?? "").trim()

  if (root === "") {
    return {
      available: false,
      reason:
        `This deployment has no local storage directory configured, so there is nowhere to ` +
        `migrate to. Set ${LOCAL_STORAGE_PATH_ENV} in the environment — under the persistent ` +
        `volume, e.g. /data/uploads — and restart, then start the migration. The path is ` +
        `deployment configuration and cannot be set from here: one that points outside the ` +
        `persistent volume loses every file on the next restart, silently.`,
    }
  }

  return { available: true, root }
}

/** What a create-migration request may carry. Note the absence of a local root. */
export interface DestinationInput {
  driver: string
  endpoint?: string
  region?: string
  bucket?: string
  accessKeyId?: string
  secretAccessKey?: string
}

/**
 * The destination a request asked for, or a refusal.
 *
 * NO MESSAGE HERE QUOTES A SUBMITTED VALUE. A rejected endpoint echoed into a
 * response is a credential in a log and a support ticket, and the operator
 * already knows what they typed.
 */
export function buildDestinationConfig(
  input: DestinationInput,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedStorageConfig {
  if (input.driver === "local") {
    // THE SUBMITTED ROOT, IF ANY, IS DISCARDED — not validated, not compared
    // against an allowlist. See the note at the top of this file.
    const candidate = resolveLocalDestinationCandidate(env)
    if (!candidate.available) {
      throw new MigrationDestinationError("local_not_configured", candidate.reason)
    }
    return { driver: "local", root: candidate.root }
  }

  if (input.driver !== "s3") {
    throw new MigrationDestinationError(
      "driver_invalid",
      'A migration destination must be "s3" or "local". A bundled Garage deployment is "s3": ' +
        "Garage is an S3-compatible server, not a separate driver.",
    )
  }

  const bucket = (input.bucket ?? "").trim()
  if (bucket === "") {
    throw new MigrationDestinationError("bucket_required", "The destination bucket is required.")
  }

  const accessKeyId = (input.accessKeyId ?? "").trim()
  const secretAccessKey = input.secretAccessKey ?? ""
  if (accessKeyId === "" || secretAccessKey === "") {
    throw new MigrationDestinationError(
      "credentials_required",
      "An access key ID and a secret access key are required for an S3 destination.",
    )
  }

  const endpoint = (input.endpoint ?? "").trim()
  if (endpoint !== "") {
    let parsed: URL
    try {
      parsed = new URL(endpoint)
    } catch {
      throw new MigrationDestinationError(
        "endpoint_invalid",
        "The destination endpoint is not a valid URL.",
      )
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      // `file://`, `gopher://` and friends have no business reaching an S3
      // client. This is the one field on this form that names a network target.
      throw new MigrationDestinationError(
        "endpoint_invalid",
        "The destination endpoint must be an http:// or https:// URL.",
      )
    }
  }

  return {
    driver: "s3",
    endpoint: endpoint === "" ? undefined : endpoint,
    region: (input.region ?? "").trim() || undefined,
    bucket,
    accessKeyId,
    secretAccessKey,
  }
}
