import { S3Client } from "@aws-sdk/client-s3"
import { getS3Config } from "@/Framework/Settings/SettingsService"

/**
 * The S3 driver's connection to its bucket.
 *
 * Was a module-scope singleton built once from env vars at import time. Now
 * resolved per call from `getS3Config()` (settings row, falling back to env
 * vars) so an admin changing the bucket or credentials in Settings takes effect
 * on the next request — no restart.
 *
 * Constructing an `S3Client` is cheap (it just holds config; no connection is
 * opened), so there is nothing to cache here — `getS3Config()` itself is
 * already cached (see `SettingsService.ts`), which is where the real cost (a
 * database read) would otherwise live.
 *
 * ONE FUNCTION RETURNING BOTH HALVES, rather than the previous pair of
 * `getS3Client()` and `getS3Bucket()`. Each of those resolved the configuration
 * independently, so every storage operation read it twice — and, more than
 * cosmetically, the two reads could straddle a cache expiry and hand one
 * operation a client built from the old credentials together with the new
 * bucket name. Resolving once per operation makes that impossible.
 */
export interface S3Connection {
  client: S3Client
  bucket: string
}

export async function getS3Connection(): Promise<S3Connection> {
  const config = await getS3Config()

  return {
    client: new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Load-bearing for Garage and every other non-AWS S3-compatible
      // provider, and assumed by `backfillContentImageUrls.ts` when it derives
      // an object key from a presigned URL's first path segment.
      forcePathStyle: true,
    }),
    bucket: config.bucket,
  }
}
