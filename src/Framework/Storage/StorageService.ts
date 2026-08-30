import { resolveStorageDriver } from "./resolveStorageDriver"
import { StoragePresigningUnsupportedError } from "./StorageDriver"

/**
 * The application's storage entry point.
 *
 * This file used to be the S3 implementation: every method built an
 * `@aws-sdk/client-s3` command inline, so a generic name sat on top of one
 * vendor's protocol. The AWS SDK now lives in `drivers/S3StorageDriver.ts` and
 * this is a dispatcher — it holds no protocol knowledge and imports no SDK.
 *
 * THE PUBLIC SURFACE IS UNCHANGED, deliberately. Around thirty call sites reach
 * storage through `StorageService.<method>`, and a refactor that also renamed
 * them would have buried the one question worth answering — did the behaviour
 * change? — under a diff nobody could read. Method names, argument order,
 * return types and thrown errors are all exactly what they were.
 *
 * IT REMAINS A PLAIN OBJECT LITERAL, not a class instance. `vi.spyOn` needs own,
 * writable properties, and `tests/setup/prerequisites.test.ts` stubs
 * `uploadObject`, `downloadObject` and `deleteObject` on it to drive the
 * first-run storage probe without a bucket.
 */

// Re-exported from their new home so importers of these types keep working:
// they describe FlowCMS's storage vocabulary, not S3's, and they now belong
// with the contract rather than with one implementation of it.
export type { StorageObjectSummary, DirectoryListing } from "./StorageDriver"

export const StorageService = {
  async uploadObject(key: string, body: Buffer | Uint8Array, contentType?: string): Promise<void> {
    const driver = await resolveStorageDriver()
    return driver.uploadObject(key, body, contentType)
  },

  async downloadObject(key: string): Promise<Buffer> {
    const driver = await resolveStorageDriver()
    return driver.downloadObject(key)
  },

  async deleteObject(key: string): Promise<void> {
    const driver = await resolveStorageDriver()
    return driver.deleteObject(key)
  },

  async listObjects(prefix?: string) {
    const driver = await resolveStorageDriver()
    return driver.listObjects(prefix)
  },

  async listDirectory(prefix: string = "") {
    const driver = await resolveStorageDriver()
    return driver.listDirectory(prefix)
  },

  async createDirectory(prefix: string): Promise<void> {
    const driver = await resolveStorageDriver()
    return driver.createDirectory(prefix)
  },

  async deletePrefix(prefix: string): Promise<void> {
    const driver = await resolveStorageDriver()
    return driver.deletePrefix(prefix)
  },

  async renamePrefix(oldPrefix: string, newPrefix: string): Promise<void> {
    const driver = await resolveStorageDriver()
    return driver.renamePrefix(oldPrefix, newPrefix)
  },

  async copyPrefix(oldPrefix: string, newPrefix: string): Promise<void> {
    const driver = await resolveStorageDriver()
    return driver.copyPrefix(oldPrefix, newPrefix)
  },

  async copyObject(oldKey: string, newKey: string): Promise<void> {
    const driver = await resolveStorageDriver()
    return driver.copyObject(oldKey, newKey)
  },

  async renameObject(oldKey: string, newKey: string): Promise<void> {
    const driver = await resolveStorageDriver()
    return driver.renameObject(oldKey, newKey)
  },

  /**
   * A presigned URL the browser can load directly from the object store.
   *
   * STILL S3-SHAPED, AND STILL NAMED THAT WAY. Every caller — File Manager
   * thumbnails, the admin layout's logo, the post and page APIs — depends on
   * getting back a URL that points at the bucket and carries an
   * `X-Amz-Signature`, and this phase changes none of that.
   *
   * The driver member is optional (a filesystem backend has nothing to sign),
   * so this refuses explicitly rather than calling `undefined`. With `s3` the
   * only registered driver that refusal is unreachable in production; it exists
   * so the phase that adds a driver without presigning meets a named error at a
   * known place instead of a `TypeError` somewhere in a page render.
   */
  async getPresignedDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const driver = await resolveStorageDriver()
    if (!driver.getPresignedDownloadUrl) {
      throw new StoragePresigningUnsupportedError(driver.name)
    }
    return driver.getPresignedDownloadUrl(key, expiresInSeconds)
  },
}
