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
 * WHAT IS DELIBERATELY NOT IN HERE: anything that only S3 can do. See
 * `getPresignedDownloadUrl` below.
 */

/** One stored object, as the File Manager needs to render it. */
export interface StorageObjectSummary {
  key: string
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
export type StorageDriverName = "s3"

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

  copyObject(oldKey: string, newKey: string): Promise<void>
  renameObject(oldKey: string, newKey: string): Promise<void>
  copyPrefix(oldPrefix: string, newPrefix: string): Promise<void>
  renamePrefix(oldPrefix: string, newPrefix: string): Promise<void>

  /**
   * OPTIONAL, AND NAMED FOR WHAT IT ACTUALLY IS.
   *
   * This is not a generic "give me a URL" method wearing an S3 name — it is
   * genuinely S3 presigning, and it is optional because a filesystem backend
   * has nothing to sign. Calling it produces a URL that points AT THE OBJECT
   * STORE and carries an `X-Amz-Signature`; today the browser loads that URL
   * directly for every File Manager thumbnail and admin-side image.
   *
   * The honest alternative was to rename it to something provider-neutral now.
   * That was rejected for this phase: the name would have promised a
   * capability no code implements yet, and a caller reading `getReadUrl` would
   * reasonably assume it works on any driver. An optional member says the true
   * thing — some backends can do this, some cannot — and it makes the callers
   * that depend on presigning findable, because they are exactly the ones that
   * have to handle its absence.
   *
   * Generalising this into a provider-neutral read URL is the next phase's
   * work, and it is a behaviour change with its own consequences (a proxied
   * route means bytes flow through the application), which is why it is not
   * smuggled in under a rename here.
   */
  getPresignedDownloadUrl?(key: string, expiresInSeconds?: number): Promise<string>
}

/**
 * Raised when a caller needs presigning and the active driver has none.
 *
 * A distinct type rather than a bare `Error` because the callers that will have
 * to handle it — thumbnails, OG images, the admin layout's logo — each want a
 * different fallback, and `catch` needs something to discriminate on. Nothing
 * throws it today: with `s3` the only driver, the capability is always present.
 * It exists so that the phase which adds a driver without presigning finds a
 * defined failure mode instead of `undefined is not a function`.
 */
export class StoragePresigningUnsupportedError extends Error {
  constructor(driverName: string) {
    super(`The "${driverName}" storage driver cannot produce presigned URLs.`)
    this.name = "StoragePresigningUnsupportedError"
  }
}
