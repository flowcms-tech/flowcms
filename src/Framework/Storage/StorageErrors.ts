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
