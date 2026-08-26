import {
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { getS3Client, getS3Bucket } from "./s3Client"

export interface StorageObjectSummary {
  key: string
  size: number
  lastModified: Date
}

export interface DirectoryListing {
  directories: string[]
  files: StorageObjectSummary[]
}

async function copyAllUnderPrefix(oldPrefix: string, newPrefix: string): Promise<void> {
  const client = await getS3Client()
  const bucket = await getS3Bucket()

  let continuationToken: string | undefined
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: oldPrefix,
        ContinuationToken: continuationToken,
      })
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
            CopySource: encodeURIComponent(`${bucket}/${oldKey}`),
            Key: newKey,
          })
        )
      })
    )

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (continuationToken)
}

export const StorageService = {
  async uploadObject(key: string, body: Buffer | Uint8Array, contentType?: string): Promise<void> {
    const client = await getS3Client()
    const bucket = await getS3Bucket()
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    )
  },

  async downloadObject(key: string): Promise<Buffer> {
    const client = await getS3Client()
    const bucket = await getS3Bucket()
    const res = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    )
    const bytes = await res.Body!.transformToByteArray()
    return Buffer.from(bytes)
  },

  async deleteObject(key: string): Promise<void> {
    const client = await getS3Client()
    const bucket = await getS3Bucket()
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key })
    )
  },

  async listObjects(prefix?: string): Promise<StorageObjectSummary[]> {
    const client = await getS3Client()
    const bucket = await getS3Bucket()
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix })
    )
    return (res.Contents ?? []).map((obj) => ({
      key: obj.Key!,
      size: obj.Size ?? 0,
      lastModified: obj.LastModified ?? new Date(0),
    }))
  },

  async listDirectory(prefix: string = ""): Promise<DirectoryListing> {
    const client = await getS3Client()
    const bucket = await getS3Bucket()
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: "/" })
    )
    const directories = (res.CommonPrefixes ?? [])
      .map((cp) => cp.Prefix)
      .filter((p): p is string => Boolean(p))
    const files = (res.Contents ?? [])
      .filter((obj) => obj.Key && obj.Key !== prefix)
      .map((obj) => ({
        key: obj.Key!,
        size: obj.Size ?? 0,
        lastModified: obj.LastModified ?? new Date(0),
      }))
    return { directories, files }
  },

  async createDirectory(prefix: string): Promise<void> {
    const client = await getS3Client()
    const bucket = await getS3Bucket()
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: prefix, Body: Buffer.alloc(0) })
    )
  },

  async deletePrefix(prefix: string): Promise<void> {
    const client = await getS3Client()
    const bucket = await getS3Bucket()

    let continuationToken: string | undefined
    do {
      const res = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      )
      const keys = (res.Contents ?? [])
        .map((obj) => obj.Key)
        .filter((key): key is string => Boolean(key))

      if (keys.length > 0) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })) },
          })
        )
      }

      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
    } while (continuationToken)
  },

  async renamePrefix(oldPrefix: string, newPrefix: string): Promise<void> {
    await copyAllUnderPrefix(oldPrefix, newPrefix)
    await StorageService.deletePrefix(oldPrefix)
  },

  async copyPrefix(oldPrefix: string, newPrefix: string): Promise<void> {
    await copyAllUnderPrefix(oldPrefix, newPrefix)
  },

  async copyObject(oldKey: string, newKey: string): Promise<void> {
    const client = await getS3Client()
    const bucket = await getS3Bucket()
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: encodeURIComponent(`${bucket}/${oldKey}`),
        Key: newKey,
      })
    )
  },

  async renameObject(oldKey: string, newKey: string): Promise<void> {
    await StorageService.copyObject(oldKey, newKey)
    await StorageService.deleteObject(oldKey)
  },

  async getPresignedDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const client = await getS3Client()
    const bucket = await getS3Bucket()
    const command = new GetObjectCommand({ Bucket: bucket, Key: key })
    return getSignedUrl(client, command, { expiresIn: expiresInSeconds })
  },
}
