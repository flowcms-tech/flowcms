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
      /**
       * DO NOT let the SDK add or validate its own checksums opportunistically.
       *
       * Recent AWS SDK v3 versions default both of these to `WHEN_SUPPORTED`,
       * which attaches a CRC32 to uploads and validates one on downloads. On
       * AWS that is fine. On an S3-COMPATIBLE server it is not: a multipart
       * upload's `x-amz-checksum-crc32` is a checksum OF THE PART CHECKSUMS, not
       * of the whole object, and implementations differ on how they compute and
       * return it. Garage returns a value the SDK then rejects, so a
       * multipart-uploaded object could be written successfully and became
       * unreadable —
       *
       *   Checksum mismatch: expected "SoXlrg==" but received "tM+uwg=="
       *
       * — which is exactly what a migration hit when it read an object back to
       * verify it. Found against a real Garage instance; no unit test with a
       * mocked SDK could have.
       *
       * Turning this off loses nothing FlowCMS relies on. Integrity of a
       * migrated object is established by reading it back and comparing
       * SHA-256 over the actual bytes, which is stronger than a CRC32 the
       * server computes about itself, and `WHEN_REQUIRED` still supplies
       * checksums for the operations that genuinely mandate them.
       */
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",

    }),
    bucket: config.bucket,
  }
}
