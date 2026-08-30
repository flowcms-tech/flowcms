import { S3Client } from "@aws-sdk/client-s3"
import { createS3StorageDriver } from "./drivers/S3StorageDriver"
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
  // a destination addressed differently from the source would produce different
  // keys for the same object.
  return createS3StorageDriver(async () => ({
    client: new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    }),
    bucket: config.bucket,
  }))
}
