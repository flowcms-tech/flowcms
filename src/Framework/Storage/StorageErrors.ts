/**
 * Provider-neutral storage failures.
 *
 * Callers must be able to tell "that object is not there" from "the backend is
 * broken" without knowing which backend answered. S3 says `NoSuchKey`, a
 * filesystem says `ENOENT`, and a route that wants to return 404 for one and
 * 500 for the other should not have to know both vocabularies.
 *
 * DELIBERATELY NOT A REWRITE OF THE EXISTING CONFIGURATION ERRORS. The
 * `"S3 is not configured"` string that `checkStoragePrerequisite` and
 * `checkStorage` match on is untouched here — turning that into a typed error
 * belongs with the phase that introduces a driver discriminant, because that is
 * the phase where the classification actually changes meaning.
 */

/**
 * The key names nothing.
 *
 * Distinct from a backend failure because the correct response differs: a
 * missing object is a 404, an unreachable backend is a 500, and conflating them
 * makes an outage look like a typo.
 */
export class StorageObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`No stored object at "${key}".`)
    this.name = "StorageObjectNotFoundError"
  }
}

/**
 * The key cannot be turned into a safe location inside the storage root.
 *
 * Thrown by the LOCAL driver's path resolution, and it is a security control
 * rather than a validation nicety — see `localPath.ts`. The message never
 * echoes the offending key: it is attacker-supplied and ends up in logs.
 */
export class UnsafeStorageKeyError extends Error {
  constructor(reason: string) {
    super(`That storage key is not usable: ${reason}.`)
    this.name = "UnsafeStorageKeyError"
  }
}

/**
 * The backend refused or failed the operation for a reason the caller cannot
 * fix by choosing a different key — a permission denial, a full disk, a
 * read-only mount.
 *
 * Carries the original error as `cause` so the server log keeps the detail that
 * the message deliberately omits.
 */
export class StorageAccessError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`Storage ${operation} failed.`)
    this.name = "StorageAccessError"
    this.cause = cause
  }
}

/**
 * What is wrong with the deployment's storage configuration.
 *
 * A CODE, NOT A MESSAGE, and that distinction is the entire reason this type
 * exists. Readiness and first-run setup used to classify storage by running
 * `error.message.includes("S3 is not configured")` against a human-readable
 * string — so the sentence in `getS3Config` was load-bearing program logic that
 * looked like prose, and rewording it would have silently reclassified every
 * deployment's state.
 *
 * It also could not survive a second backend: a Local installation has no S3
 * credentials by design, and matching that string would have reported a
 * correctly-configured filesystem deployment as a broken S3 one.
 */
export type StorageConfigProblem =
  /** `STORAGE_DRIVER` names something that is not a driver. */
  | "driver_invalid"
  /** Driver is `s3`, but bucket or credentials are absent from settings AND env. */
  | "s3_incomplete"
  /** Driver is `local`, but `LOCAL_STORAGE_PATH` is unset. */
  | "local_path_missing"
  /** Driver is `local` and the root cannot be created, read or written. */
  | "local_path_unusable"
  /**
   * A completed installation could not record, or could not confirm, which
   * storage location is active.
   *
   * Distinct from the four above: nothing is wrong with the CONFIGURATION, the
   * problem is that FlowCMS cannot establish the durable fact of which location
   * is in use. It refuses rather than falling back to environment topology,
   * because falling back is precisely how an environment edit silently
   * relocates a live installation.
   */
  | "active_topology_unavailable"

/**
 * The deployment's storage configuration cannot be resolved.
 *
 * Distinct from `StorageAccessError`, which means a configured backend failed:
 * this one means there is nothing coherent to talk to yet. The two lead to
 * different operator actions — edit configuration versus investigate an outage —
 * and readiness reports them as different states.
 *
 * `message` stays useful for a server log. `problem` is what code branches on.
 */
export class StorageConfigurationError extends Error {
  readonly problem: StorageConfigProblem

  constructor(problem: StorageConfigProblem, message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = "StorageConfigurationError"
    this.problem = problem
    if (options?.cause !== undefined) this.cause = options.cause
  }
}
