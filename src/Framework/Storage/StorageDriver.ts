/**
 * What a storage backend must be able to do.
 *
 * `StorageService` used to BE the S3 implementation: every method built an
 * `@aws-sdk/client-s3` command inline, so "the storage layer" and "S3" were the
 * same file under a generic name. This interface is the seam that separates
 * them, so a second backend can exist without every caller learning about it.
 *
 * WHAT IS DELIBERATELY IN HERE: the whole vocabulary the File Manager speaks,
 * including the composite operations (`renameObject`, `renamePrefix`,
 * `copyPrefix`). They are not conveniences that belong one layer up. On S3 a
 * rename genuinely is copy-then-delete because the protocol has no rename; on a
 * filesystem it is a single atomic `rename()`. Putting them on the driver lets
 * each backend answer with its own best implementation instead of forcing the
 * S3 shape onto everything.
 *
 * WHAT IS DELIBERATELY NOT IN HERE: anything only one backend can do. S3
 * presigning used to hang off this interface as an optional member; Phase 2
 * removed it, because once every caller reads through an application route
 * there is no generic consumer left and an optional capability that nothing
 * uses is just a leak of one vendor's model into a shared contract.
 */

/** One stored object, as the File Manager needs to render it. */
export interface StorageObjectSummary {
  key: string
  size: number
  lastModified: Date
}

/**
 * One entry in a full-store scan: a stored object, or a folder that exists in
 * its own right.
 */
export interface StorageEntry {
  key: string
  /** `directory` means an S3 marker key ending in `/`, or an empty folder. */
  kind: "file" | "directory"
  size: number
  lastModified: Date
}

/**
 * One level of the tree.
 *
 * `directories` are full prefixes (`posts/2026/`), not basenames — the File
 * Manager navigates by prefix, and re-deriving one from a basename plus the
 * parent is how off-by-one path bugs get in.
 */
export interface DirectoryListing {
  directories: string[]
  files: StorageObjectSummary[]
}

/**
 * The backends that exist.
 *
 * `garage` IS NOT AND WILL NOT BE A MEMBER. Garage is a self-hosted
 * S3-compatible server: FlowCMS reaches it with the `s3` driver pointed at
 * `http://garage:3900`, and the driver cannot tell it apart from AWS, R2 or
 * Wasabi — which is precisely why an operator can move off it by changing five
 * environment variables. A `garage` driver would turn a deployment choice into
 * an application behaviour, and there would then be a code path that only ever
 * runs on one vendor.
 */
export type StorageDriverName = "s3" | "local"

export interface StorageDriver {
  /** Identifies the backend in errors and diagnostics. */
  readonly name: StorageDriverName

  uploadObject(key: string, body: Buffer | Uint8Array, contentType?: string): Promise<void>
  downloadObject(key: string): Promise<Buffer>
  deleteObject(key: string): Promise<void>

  /** Recursive: every key under the prefix, at any depth. */
  listObjects(prefix?: string): Promise<StorageObjectSummary[]>

  /** One level only: immediate children, folders separated from files. */
  listDirectory(prefix?: string): Promise<DirectoryListing>

  createDirectory(prefix: string): Promise<void>
  deletePrefix(prefix: string): Promise<void>

  /**
   * Every entry in the store, streamed.
   *
   * SEPARATE FROM `listObjects` ON PURPOSE, and migration is why. `listObjects`
   * paginates internally and then returns ONE ARRAY — fine for a folder, and
   * exactly wrong for a store with half a million objects, where it means
   * holding the entire inventory in memory before the first byte is copied.
   *
   * An async iterator lets a migration work in bounded batches and stop
   * wherever it likes, which is what makes it resumable after a restart.
   *
   * `after` resumes from a key: enumeration is in ascending key order on both
   * backends, so the last key processed is a complete resume token. A numeric
   * offset would not be — the store changes while the migration runs.
   *
   * DIRECTORIES ARE ENTRIES TOO. An empty folder is a zero-byte marker object
   * on S3 and a real directory on a filesystem, and a migration that ignored
   * them would silently drop every empty folder an operator had made.
   */
  scanEntries(options?: { after?: string }): AsyncIterable<StorageEntry>

  /**
   * The object's bytes, in chunks.
   *
   * SEPARATE FROM `downloadObject` ON PURPOSE. `downloadObject` returns a
   * Buffer, which is right for serving a 200 KB image through a route and wrong
   * for hashing a 2 GB video: the whole object would sit in memory at once, and
   * a migration verifying a store would do that for every object in turn.
   *
   * Used only by migration. The File Manager and the public image route keep
   * using `downloadObject`, because a route that already buffers its response
   * gains nothing from streaming and would only get more complicated.
   *
   * Throws `StorageObjectNotFoundError` for a missing key, like its sibling.
   */
  openReadStream(key: string): Promise<AsyncIterable<Uint8Array>>

  copyObject(oldKey: string, newKey: string): Promise<void>
  renameObject(oldKey: string, newKey: string): Promise<void>
  copyPrefix(oldPrefix: string, newPrefix: string): Promise<void>
  renamePrefix(oldPrefix: string, newPrefix: string): Promise<void>
}
