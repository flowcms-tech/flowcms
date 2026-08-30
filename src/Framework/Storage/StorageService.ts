import { resolveStorageDriver } from "./resolveStorageDriver"
import { assertStorageWritable } from "./storageWriteLock"

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
 * IT IS ALSO THE WRITE GATE. Every method that changes stored bytes calls
 * `assertStorageWritable()` first, so storage mutations stop during the brief
 * window in which a migration is switching an installation from one location to
 * another. The gate is here rather than in the nine File Manager routes because
 * the routes are not the boundary — they are nine of the current callers, and a
 * tenth added later would arrive unguarded. Reads are deliberately NOT gated:
 * the public site keeps serving images throughout.
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
    // One check per LOGICAL mutation. `renamePrefix` issues many driver
    // requests underneath; gating each would cost more and protect no better.
    await assertStorageWritable()
    const driver = await resolveStorageDriver()
    return driver.uploadObject(key, body, contentType)
  },

  async downloadObject(key: string): Promise<Buffer> {
    const driver = await resolveStorageDriver()
    return driver.downloadObject(key)
  },

  async deleteObject(key: string): Promise<void> {
    // One check per LOGICAL mutation. `renamePrefix` issues many driver
    // requests underneath; gating each would cost more and protect no better.
    await assertStorageWritable()
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
    // One check per LOGICAL mutation. `renamePrefix` issues many driver
    // requests underneath; gating each would cost more and protect no better.
    await assertStorageWritable()
    const driver = await resolveStorageDriver()
    return driver.createDirectory(prefix)
  },

  async deletePrefix(prefix: string): Promise<void> {
    // One check per LOGICAL mutation. `renamePrefix` issues many driver
    // requests underneath; gating each would cost more and protect no better.
    await assertStorageWritable()
    const driver = await resolveStorageDriver()
    return driver.deletePrefix(prefix)
  },

  async renamePrefix(oldPrefix: string, newPrefix: string): Promise<void> {
    // One check per LOGICAL mutation. `renamePrefix` issues many driver
    // requests underneath; gating each would cost more and protect no better.
    await assertStorageWritable()
    const driver = await resolveStorageDriver()
    return driver.renamePrefix(oldPrefix, newPrefix)
  },

  async copyPrefix(oldPrefix: string, newPrefix: string): Promise<void> {
    // One check per LOGICAL mutation. `renamePrefix` issues many driver
    // requests underneath; gating each would cost more and protect no better.
    await assertStorageWritable()
    const driver = await resolveStorageDriver()
    return driver.copyPrefix(oldPrefix, newPrefix)
  },

  async copyObject(oldKey: string, newKey: string): Promise<void> {
    // One check per LOGICAL mutation. `renamePrefix` issues many driver
    // requests underneath; gating each would cost more and protect no better.
    await assertStorageWritable()
    const driver = await resolveStorageDriver()
    return driver.copyObject(oldKey, newKey)
  },

  async renameObject(oldKey: string, newKey: string): Promise<void> {
    // One check per LOGICAL mutation. `renamePrefix` issues many driver
    // requests underneath; gating each would cost more and protect no better.
    await assertStorageWritable()
    const driver = await resolveStorageDriver()
    return driver.renameObject(oldKey, newKey)
  },
}
