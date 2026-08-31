import type { S3ClientConfig } from "@aws-sdk/client-s3"

/**
 * HOW FLOWCMS TALKS TO AN S3-COMPATIBLE SERVER, IN ONE PLACE.
 *
 * There are two places an `S3Client` gets built — the ACTIVE connection, and a
 * throwaway one for a migration destination that is deliberately not active —
 * and they had the same two deviations from the SDK's defaults written out
 * twice. Two copies of an interoperability workaround is one copy away from a
 * bug that only reproduces on one of the two paths, which for these settings
 * means "only during a migration" or "only in normal use". So the settings live
 * here and both constructions spread them.
 */

/**
 * `forcePathStyle` — load-bearing for Garage and every other non-AWS provider.
 *
 * Virtual-hosted style puts the bucket in the hostname, which needs DNS the
 * operator does not control on a self-hosted server. It is also assumed by
 * `backfillContentImageUrls.ts` when it derives an object key from a URL's
 * first path segment.
 *
 * `responseChecksumValidation` — DO NOT let the SDK validate checksums on
 * RESPONSES.
 *
 * Recent AWS SDK v3 versions default this to `WHEN_SUPPORTED`, which validates
 * `x-amz-checksum-crc32` when a response carries one. On AWS that is fine. On
 * an S3-COMPATIBLE server it is not: a multipart upload's checksum is a
 * checksum OF THE PART CHECKSUMS rather than of the whole object, and
 * implementations differ on how they compute and return it. Garage returns a
 * value the SDK rejects, so a multipart-uploaded object was written
 * successfully and then became unreadable —
 *
 *   Checksum mismatch: expected "O4buDA==" but received "z3IZkA=="
 *
 * — which a migration hit the moment it read an object back to verify it. Found
 * against a real Garage instance; no test with a mocked SDK could have.
 *
 * NARROWED AFTER MEASURING. An earlier attempt also set
 * `requestChecksumCalculation`, which turned out to be unnecessary: against
 * real Garage, request-side checksums are fine and only the RESPONSE validation
 * fails. Leaving the request side at the SDK default keeps the CRC32 a
 * correctly-implementing server can use to detect corruption in transit, and
 * deviates from the vendor in exactly one place instead of two.
 *
 * `WHEN_REQUIRED` is not "never": the SDK still validates where a response
 * explicitly opts in, and still SENDS the checksums operations like
 * `DeleteObjects` mandate.
 *
 * WHAT IS ACTUALLY LOST, stated plainly so it is not over-read: opportunistic
 * validation of ordinary GET responses. Migration replaces it with something
 * stronger — SHA-256 over the bytes actually read back from the destination —
 * but ORDINARY READS get no such check. The File Manager and the public image
 * route do not verify a hash, and this setting does not give them one.
 */
export const S3_COMPATIBILITY_OPTIONS = {
  forcePathStyle: true,
  responseChecksumValidation: "WHEN_REQUIRED",
} as const satisfies Partial<S3ClientConfig>
