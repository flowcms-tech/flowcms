import { randomUUID } from "node:crypto"
import { createStorageDriverFor } from "../storageDriverFactory"
import { UnsafeStorageKeyError } from "../StorageErrors"
import type { ResolvedStorageConfig } from "../storageConfig"
import type { StorageDriver } from "../StorageDriver"

/**
 * Proving a destination works BEFORE anything depends on it.
 *
 * The same shape as the first-run setup probe — write, read back, compare,
 * delete — and for the same reason: "the bucket exists" is not the claim that
 * matters. A credential that can list but not write passes a HeadBucket and
 * fails every object a migration tries to copy, several thousand objects in.
 *
 * THIS NEVER TOUCHES THE ACTIVE TOPOLOGY. It builds a throwaway driver for the
 * candidate configuration and talks to that. A failed test leaves the site
 * completely unchanged, because there was nothing to change: the destination is
 * not active, not referenced, and not written to except by this probe.
 *
 * WHY EACH STEP IS SEPARATE. An operator whose credentials can write but not
 * delete needs to be told that specifically — a single "destination test
 * failed" would send them to check the endpoint, which is fine. The failure
 * codes below each name one capability the migration will need later.
 */

export type DestinationTestFailure =
  /** The configuration cannot be turned into a working client at all. */
  | "invalid_configuration"
  /** Credentials rejected. */
  | "authentication_failed"
  /** Authenticated, but not allowed to do it. */
  | "permission_denied"
  | "write_failed"
  | "read_failed"
  /** Read back bytes that were not the ones written. */
  | "content_mismatch"
  | "delete_failed"
  /** Local only: the root does not exist and cannot be created. */
  | "path_unavailable"
  /** Local only: the root exists but cannot be written to. */
  | "path_unwritable"

export interface DestinationTestResult {
  ok: boolean
  failure?: DestinationTestFailure
  /**
   * Operator-facing explanation.
   *
   * NEVER CONTAINS A CREDENTIAL, an endpoint, a bucket name or raw exception
   * text. An endpoint can carry `user:password@` in its userinfo, and this
   * string reaches a browser, a log and probably a support ticket.
   */
  message?: string
}

/**
 * The probe key.
 *
 * Dot-prefixed and containing NO SLASH, for the reason the setup probe learned:
 * a key with a slash is one object on S3 but a directory containing a file on a
 * filesystem, and deleting the file leaves the directory behind — so every
 * tested local destination would keep a phantom folder forever.
 */
const PROBE_PREFIX = ".flowcms-destination-test-"

const PROBE_BODY = Buffer.from("flowcms destination test\n", "utf8")

function classify(error: unknown): { failure: DestinationTestFailure; message: string } {
  if (error instanceof UnsafeStorageKeyError) {
    return {
      failure: "invalid_configuration",
      message: "The destination path is not usable.",
    }
  }

  const named = error as { name?: string; code?: string; $metadata?: { httpStatusCode?: number } }
  const status = named?.$metadata?.httpStatusCode
  const name = named?.name ?? ""
  const code = named?.code ?? ""

  if (name === "InvalidAccessKeyId" || name === "SignatureDoesNotMatch" || status === 401) {
    return {
      failure: "authentication_failed",
      message: "The destination rejected those credentials.",
    }
  }
  if (name === "AccessDenied" || status === 403) {
    return {
      failure: "permission_denied",
      message:
        "Those credentials were accepted but are not allowed to write to the destination. " +
        "The migration needs read, write and delete.",
    }
  }
  if (name === "NoSuchBucket" || status === 404) {
    return {
      failure: "invalid_configuration",
      message: "The destination does not exist. Check the bucket name and endpoint.",
    }
  }
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return {
      failure: "path_unwritable",
      message: "The destination directory exists but this process cannot write to it.",
    }
  }
  if (code === "ENOENT" || code === "ENOTDIR") {
    return {
      failure: "path_unavailable",
      message: "The destination directory does not exist and could not be created.",
    }
  }

  return {
    failure: "write_failed",
    message: "The destination could not be reached.",
  }
}

/** Runs the probe against a candidate configuration. */
export async function testDestination(
  config: ResolvedStorageConfig,
  deps: { createDriver?: (c: ResolvedStorageConfig) => StorageDriver } = {},
): Promise<DestinationTestResult> {
  const key = `${PROBE_PREFIX}${randomUUID()}.txt`

  let driver: StorageDriver
  try {
    driver = (deps.createDriver ?? createStorageDriverFor)(config)
  } catch (error) {
    const { failure, message } = classify(error)
    return { ok: false, failure, message }
  }

  // 1. WRITE — the capability a HeadBucket would not have proved.
  try {
    await driver.uploadObject(key, PROBE_BODY, "text/plain")
  } catch (error) {
    const { failure, message } = classify(error)
    return { ok: false, failure: failure === "write_failed" ? "write_failed" : failure, message }
  }

  // 2. READ BACK, and 3. COMPARE. A destination that accepts writes and returns
  // something else is worse than one that refuses them, because a migration
  // would report success.
  try {
    const readBack = await driver.downloadObject(key)
    if (!Buffer.from(readBack).equals(PROBE_BODY)) {
      await driver.deleteObject(key).catch(() => {})
      return {
        ok: false,
        failure: "content_mismatch",
        message: "The destination returned different content than was written to it.",
      }
    }
  } catch (error) {
    await driver.deleteObject(key).catch(() => {})
    const { message } = classify(error)
    return { ok: false, failure: "read_failed", message }
  }

  // 4. DELETE, and the delete is CHECKED rather than attempted. The migration's
  // final reconciliation removes its own stale objects; a destination that
  // silently refuses deletes would fail there instead, after copying everything.
  try {
    await driver.deleteObject(key)
  } catch (error) {
    const { message } = classify(error)
    return { ok: false, failure: "delete_failed", message }
  }

  return { ok: true }
}
