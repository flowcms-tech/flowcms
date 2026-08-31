import { createS3StorageDriver } from "./drivers/S3StorageDriver"
import { createS3ClientFor } from "./drivers/s3Client"
import { createLocalStorageDriver } from "./drivers/LocalStorageDriver"
import type { StorageDriver } from "./StorageDriver"
import type { ResolvedStorageConfig } from "./storageConfig"

/**
 * A driver for AN ARBITRARY configuration — not necessarily the active one.
 *
 * `resolveStorageDriver()` answers "which backend serves this request". This
 * answers "give me a way to talk to THAT location", which is a different
 * question and only migration asks it: copying to a destination means talking
 * to a bucket that is deliberately not active, and testing a destination means
 * doing so before anything has been made active at all.
 *
 * Keeping the two separate is what stops a destination from ever becoming
 * reachable through the serving path by accident. Nothing here consults, or can
 * change, the active topology.
 */
export function createStorageDriverFor(config: ResolvedStorageConfig): StorageDriver {
  if (config.driver === "local") return createLocalStorageDriver(config.root)

  // A fresh client per driver, built from the configuration handed in rather
  // than from settings. `forcePathStyle` matches the active connection exactly:
  // The client is built by `s3Client.ts`, which is the only module that
  // constructs one. A destination addressed differently from the source would
  // produce different keys for the same object, and an interoperability
  // workaround applied on only one of the two paths would reproduce only
  // during a migration.
  return createS3StorageDriver(async () => ({
    client: createS3ClientFor(config),
    bucket: config.bucket,
  }))
}
