import { createHash } from "node:crypto"
import { StorageObjectNotFoundError } from "../StorageErrors"
import type { StorageDriver } from "../StorageDriver"

/**
 * PROVING TWO OBJECTS ARE THE SAME OBJECT.
 *
 * WHY NOT AN ETAG. It is the obvious candidate and it is wrong. An S3 ETag is
 * the MD5 of the object only for a single-part upload; for a multipart upload
 * it is a hash of the part hashes with the part count appended, so it depends
 * on the part size whichever client happened to upload it chose. Server-side
 * encryption changes it again. The consequences run both ways:
 *
 *   two IDENTICAL objects can carry different ETags   -> a false conflict, and
 *                                                        a migration that
 *                                                        refuses to proceed
 *   two DIFFERENT objects can carry the same ETag     -> a false match, and a
 *                                                        file silently not
 *                                                        migrated
 *
 * The second is the one that loses data. So the ETag is recorded as provider
 * metadata and never consulted for an integrity decision; SHA-256 of the actual
 * bytes decides.
 *
 * WHY NOT SIZE. Same reason, more obviously: two different images are very
 * often the same number of bytes. Size is a cheap pre-filter that can prove
 * DIFFERENCE, never sameness.
 *
 * BOUNDED MEMORY. Hashing reads through `openReadStream`, so a 2 GB video costs
 * one chunk at a time rather than 2 GB of heap. `downloadObject` would have
 * been simpler and would put the entire object in memory — and a migration
 * verifies every object in the store in turn, so "one at a time" would still
 * mean the largest object, repeatedly.
 */

export interface ContentDigest {
  /** Lowercase hex SHA-256 of the object's bytes. */
  hash: string
  /** Bytes actually read, counted while hashing rather than taken from metadata. */
  size: number
}

/**
 * Hashes an object without holding it in memory.
 *
 * The size is COUNTED here rather than read from a listing, so it describes the
 * bytes that were actually hashed. A listing's size and the object's real
 * content can disagree — the object may have been replaced between the two
 * calls — and verification that mixed the two would be comparing a hash of one
 * thing with the size of another.
 */
export async function digestObject(driver: StorageDriver, key: string): Promise<ContentDigest> {
  const stream = await driver.openReadStream(key)
  const hash = createHash("sha256")
  let size = 0

  for await (const chunk of stream) {
    // Chunks are already Uint8Array; no copy, no accumulation. Nothing here
    // retains a reference to a chunk after updating the digest, which is what
    // keeps the peak footprint at one chunk.
    hash.update(chunk)
    size += chunk.byteLength
  }

  return { hash: hash.digest("hex"), size }
}

/**
 * Whether two objects are byte-identical.
 *
 * Absence is an ANSWER, not an error: a destination that does not have the key
 * is exactly what a migration expects to find, and throwing here would make the
 * caller catch to learn something ordinary. A missing SOURCE object is
 * different — that is a store changing underneath the migration — so it is
 * reported distinctly.
 */
export type ContentComparison =
  | { result: "identical"; hash: string; size: number }
  | { result: "different"; sourceHash: string; sourceSize: number; destinationHash: string; destinationSize: number }
  | { result: "destination_missing"; sourceHash: string; sourceSize: number }
  | { result: "source_missing" }

export async function compareObjects(
  source: { driver: StorageDriver; key: string },
  destination: { driver: StorageDriver; key: string },
): Promise<ContentComparison> {
  let sourceDigest: ContentDigest
  try {
    sourceDigest = await digestObject(source.driver, source.key)
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) return { result: "source_missing" }
    throw error
  }

  let destinationDigest: ContentDigest
  try {
    destinationDigest = await digestObject(destination.driver, destination.key)
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) {
      return {
        result: "destination_missing",
        sourceHash: sourceDigest.hash,
        sourceSize: sourceDigest.size,
      }
    }
    throw error
  }

  if (sourceDigest.hash === destinationDigest.hash) {
    return { result: "identical", hash: sourceDigest.hash, size: sourceDigest.size }
  }

  return {
    result: "different",
    sourceHash: sourceDigest.hash,
    sourceSize: sourceDigest.size,
    destinationHash: destinationDigest.hash,
    destinationSize: destinationDigest.size,
  }
}
