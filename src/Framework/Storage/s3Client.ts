import { S3Client } from "@aws-sdk/client-s3"
import { getS3Config } from "@/Framework/Settings/SettingsService"

/**
 * Was a module-scope singleton built once from env vars at import time.
 * Now resolved per call from getS3Config() (settings row, falling back to
 * env vars) so an admin changing the bucket/credentials in Settings takes
 * effect on the next request — no restart.
 *
 * Constructing an S3Client is cheap (it just holds config, no connection is
 * opened), so there's nothing to cache here — getS3Config() itself is
 * already cached (see SettingsService.ts), which is where the real cost
 * (a DB read) would otherwise live.
 */
export async function getS3Client(): Promise<S3Client> {
  const config = await getS3Config()
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  })
}

export async function getS3Bucket(): Promise<string> {
  const config = await getS3Config()
  return config.bucket
}
