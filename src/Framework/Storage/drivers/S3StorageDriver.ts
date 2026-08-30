import {
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3"
import { getS3Connection as activeS3Connection, type S3Connection } from "./s3Client"
import { StorageObjectNotFoundError } from "../StorageErrors"
import type { DirectoryListing, StorageDriver, StorageObjectSummary } from "../StorageDriver"

/**
 * The S3-compatible backend: AWS S3, Cloudflare R2, Wasabi, Backblaze B2,
 * DigitalOcean Spaces, MinIO, and the Garage instance FlowCMS bundles.
 *
 * This is `StorageService`'s previous body, moved rather than rewritten. Every
 * command below is issued with the same inputs it was before the driver seam
 * existed, because the operator-visible surface of a storage layer is the
 * requests it makes — not the shape of the TypeScript around them.
 *
 * NOTHING IN HERE BRANCHES ON THE PROVIDER. There is no `if (isGarage)`, and
 * there must never be one: the moment a code path runs only against one vendor,
 * "any S3-compatible endpoint" stops being true and the promise that an
 * operator can move from Garage to R2 by editing five environment variables
 * stops being keepable.
 */

/**
 * Whether an SDK error means "that key is not there".
 *
 * Two spellings, because providers disagree: AWS raises `NoSuchKey`, while
 * MinIO and several others raise `NotFound`. The HTTP status is checked as well
 * so a provider using a third name still lands in the right branch.
 */
function isMissingObject(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const named = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return (
    named.name === "NoSuchKey" ||
    named.name === "NotFound" ||
    named.$metadata?.httpStatusCode === 404
  )
}

/** Rows from a `ListObjectsV2` response, in FlowCMS's own vocabulary. */
function toSummaries(contents: { Key?: string; Size?: number; LastModified?: Date }[]): StorageObjectSummary[] {
  return contents.map((obj) => ({
    key: obj.Key!,
    size: obj.Size ?? 0,
    // A listing entry without these is malformed rather than impossible, and a
    // File Manager that throws on one bad row shows the operator nothing at
    // all. Defaults keep the rest of the folder visible.
    lastModified: obj.LastModified ?? new Date(0),
  }))
}

/**
 * `CopySource` for a server-side copy.
 *
 * `encodeURIComponent` percent-encodes the `/` separator too, which looks wrong
 * and is nonetheless what every existing FlowCMS deployment's provider already
 * accepts. Changing it is a compatibility risk with no benefit, so it is
 * preserved exactly and pinned by a characterization test.
 */
function copySourceFor(bucket: string, key: string): string {
  return encodeURIComponent(`${bucket}/${key}`)
}

/**
 * Every page of a listing, followed to the end.
 *
 * `ListObjectsV2` caps a response at 1000 keys and reports `IsTruncated`. Every
 * listing in this driver goes through here so that no caller can accidentally
 * read only the first page — which is precisely what `listObjects` and
 * `listDirectory` used to do, silently truncating any folder past a thousand
 * objects with no error and no sign in the UI.
 *
 * `IsTruncated` IS THE AUTHORITY, not the presence of a token. A provider that
 * echoes a stale `NextContinuationToken` on its final page would otherwise put
 * this in an endless loop.
 */
async function* listPages(
  client: S3Connection["client"],
  bucket: string,
  prefix: string | undefined,
  delimiter?: string,
) {
  let continuationToken: string | undefined
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        Delimiter: delimiter,
        ContinuationToken: continuationToken,
      }),
    )
    yield res
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (continuationToken)
}

/**
 * Copies every object under one prefix to another, preserving relative paths.
 *
 * Takes the connection rather than resolving its own, so a `renamePrefix`
 * resolves configuration once for the whole operation instead of once per
 * phase.
 */
async function copyAllUnderPrefix(
  { client, bucket }: S3Connection,
  oldPrefix: string,
  newPrefix: string,
): Promise<void> {
  for await (const page of listPages(client, bucket, oldPrefix)) {
    const keys = (page.Contents ?? [])
      .map((obj) => obj.Key)
      .filter((key): key is string => Boolean(key))

    await Promise.all(
      keys.map((oldKey) => {
        const newKey = `${newPrefix}${oldKey.slice(oldPrefix.length)}`
        return client.send(
          new CopyObjectCommand({
            Bucket: bucket,
            CopySource: copySourceFor(bucket, oldKey),
            Key: newKey,
          }),
        )
      }),
    )
  }
}

/** Deletes everything under a prefix, in batches, on an existing connection. */
async function deleteAllUnderPrefix(
  { client, bucket }: S3Connection,
  prefix: string,
): Promise<void> {
  for await (const page of listPages(client, bucket, prefix)) {
    const keys = (page.Contents ?? [])
      .map((obj) => obj.Key)
      .filter((key): key is string => Boolean(key))

    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      )
    }
  }
}

/**
 * An S3 driver bound to a particular connection.
 *
 * PARAMETERISED IN PHASE 4. It used to resolve `getS3Connection()` — the
 * ACTIVE bucket — inside every method, which is right for serving requests and
 * useless for a migration: copying to a destination means talking to a bucket
 * that is deliberately NOT the active one, and testing a destination means
 * doing so before anything has been made active at all.
 *
 * The exported `S3StorageDriver` below is this factory bound to the active
 * connection, so nothing about the serving path changed.
 */
export function createS3StorageDriver(connect: () => Promise<S3Connection>): StorageDriver {
  const getS3Connection = connect
  return {
  name: "s3",

  async uploadObject(key, body, contentType) {
    const { client, bucket } = await getS3Connection()
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    )
  },

  async downloadObject(key) {
    const { client, bucket } = await getS3Connection()
    let res
    try {
      res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    } catch (error) {
      // Translated so callers need one vocabulary instead of two. Everything
      // else — AccessDenied above all — is rethrown untouched: reporting a
      // credentials problem as "missing" would send an operator looking for a
      // file that is sitting right there.
      if (isMissingObject(error)) throw new StorageObjectNotFoundError(key)
      throw error
    }
    const bytes = await res.Body!.transformToByteArray()
    return Buffer.from(bytes)
  },

  async deleteObject(key) {
    const { client, bucket } = await getS3Connection()
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  },

  async listObjects(prefix) {
    const { client, bucket } = await getS3Connection()
    const found: StorageObjectSummary[] = []

    for await (const page of listPages(client, bucket, prefix)) {
      found.push(...toSummaries(page.Contents ?? []))
    }
    return found
  },

  async listDirectory(prefix = ""): Promise<DirectoryListing> {
    const { client, bucket } = await getS3Connection()

    // A Set, because a `CommonPrefix` may in principle be reported on more than
    // one page. Insertion order is preserved, so the result still arrives in
    // S3's own binary key order.
    const directories = new Set<string>()
    const files: StorageObjectSummary[] = []

    for await (const page of listPages(client, bucket, prefix, "/")) {
      for (const cp of page.CommonPrefixes ?? []) {
        if (cp.Prefix) directories.add(cp.Prefix)
      }
      // `obj.Key !== prefix` drops the folder's own marker object, which would
      // otherwise appear as a zero-byte file inside itself. Applied per page:
      // the marker is not guaranteed to land on the first one.
      files.push(
        ...toSummaries((page.Contents ?? []).filter((obj) => obj.Key && obj.Key !== prefix)),
      )
    }

    return { directories: [...directories], files }
  },

  async createDirectory(prefix) {
    const { client, bucket } = await getS3Connection()
    // S3 has no directories. A zero-byte object whose key ends in `/` is the
    // conventional marker, and it is what makes an EMPTY folder survive a
    // page reload — without it there is nothing to list.
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: prefix, Body: Buffer.alloc(0) }),
    )
  },

  async deletePrefix(prefix) {
    await deleteAllUnderPrefix(await getS3Connection(), prefix)
  },

  async *scanEntries(options) {
    const { client, bucket } = await getS3Connection()

    // `StartAfter` is S3's own resume token and is exclusive, which is what
    // makes resuming from "the last key I finished" correct rather than
    // off-by-one. Pages are yielded as they arrive, so nothing accumulates.
    let continuationToken: string | undefined
    do {
      const res = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: continuationToken,
          StartAfter: continuationToken ? undefined : options?.after,
        }),
      )
      for (const obj of res.Contents ?? []) {
        if (!obj.Key) continue
        yield {
          key: obj.Key,
          // The folder-marker convention: a zero-byte object whose key ends in
          // a slash is how an empty folder exists at all on S3.
          kind: obj.Key.endsWith("/") ? ("directory" as const) : ("file" as const),
          size: obj.Size ?? 0,
          lastModified: obj.LastModified ?? new Date(0),
        }
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
    } while (continuationToken)
  },

  async copyObject(oldKey, newKey) {
    const { client, bucket } = await getS3Connection()
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: copySourceFor(bucket, oldKey),
        Key: newKey,
      }),
    )
  },

  async renameObject(oldKey, newKey) {
    const connection = await getS3Connection()
    const { client, bucket } = connection

    // Copy FIRST, delete second, and never in one step: S3 has no rename, and
    // a failed copy must leave the source intact rather than lose the object
    // between the two calls.
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: copySourceFor(bucket, oldKey),
        Key: newKey,
      }),
    )
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: oldKey }))
  },

  async copyPrefix(oldPrefix, newPrefix) {
    await copyAllUnderPrefix(await getS3Connection(), oldPrefix, newPrefix)
  },

  async renamePrefix(oldPrefix, newPrefix) {
    const connection = await getS3Connection()
    // Same ordering rule as renameObject, one level up: everything is copied
    // before anything is deleted, so an interrupted move leaves a duplicate
    // rather than a hole.
    await copyAllUnderPrefix(connection, oldPrefix, newPrefix)
    await deleteAllUnderPrefix(connection, oldPrefix)
  },
  }
}

/**
 * The driver that serves requests: bound to the ACTIVE bucket.
 *
 * Resolved per call inside each method, exactly as before, so an admin changing
 * credentials is served by the next request rather than the next restart.
 */
export const S3StorageDriver: StorageDriver = createS3StorageDriver(activeS3Connection)
