import {
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { getS3Connection, type S3Connection } from "./s3Client"
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
  let continuationToken: string | undefined
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: oldPrefix,
        ContinuationToken: continuationToken,
      }),
    )
    const keys = (res.Contents ?? [])
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

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (continuationToken)
}

/** Deletes everything under a prefix, in batches, on an existing connection. */
async function deleteAllUnderPrefix(
  { client, bucket }: S3Connection,
  prefix: string,
): Promise<void> {
  let continuationToken: string | undefined
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    )
    const keys = (res.Contents ?? [])
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

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (continuationToken)
}

export const S3StorageDriver: StorageDriver = {
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
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const bytes = await res.Body!.transformToByteArray()
    return Buffer.from(bytes)
  },

  async deleteObject(key) {
    const { client, bucket } = await getS3Connection()
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  },

  async listObjects(prefix) {
    const { client, bucket } = await getS3Connection()
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }))
    return toSummaries(res.Contents ?? [])
  },

  async listDirectory(prefix = ""): Promise<DirectoryListing> {
    const { client, bucket } = await getS3Connection()
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: "/" }),
    )
    const directories = (res.CommonPrefixes ?? [])
      .map((cp) => cp.Prefix)
      .filter((p): p is string => Boolean(p))
    // `obj.Key !== prefix` drops the folder's own marker object, which would
    // otherwise appear as a zero-byte file inside itself.
    const files = toSummaries((res.Contents ?? []).filter((obj) => obj.Key && obj.Key !== prefix))
    return { directories, files }
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

  async getPresignedDownloadUrl(key, expiresInSeconds = 3600) {
    const { client, bucket } = await getS3Connection()
    const command = new GetObjectCommand({ Bucket: bucket, Key: key })
    return getSignedUrl(client, command, { expiresIn: expiresInSeconds })
  },
}
