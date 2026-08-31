/**
 * Refuses a settings edit that would move where files live.
 *
 * THE FOOTGUN THIS EXISTS TO CLOSE. Admin > Settings > Storage let an owner type
 * a different bucket name and press Save. The next request resolved a different
 * bucket, and every image on the site was gone: no warning, no copy, no way
 * back except remembering the old value. The stored keys were all still
 * perfectly valid — they just pointed into a bucket that no longer had anything
 * in it.
 *
 * Changing storage is a MIGRATION — test the destination, decide whether to
 * copy, verify what arrived, then cut over, with a way back if it fails. That
 * workflow is a later phase's work. Until it exists, the honest behaviour is to
 * refuse a relocation rather than half-support it, because a half-supported
 * relocation is indistinguishable from data loss.
 *
 * WHAT IS STILL ALLOWED, AND WHY IT MATTERS: rotating credentials. A new access
 * key points at the same bucket on the same endpoint; nothing moves. An
 * operator whose key has leaked needs that to be immediate, and blocking it
 * would push them towards editing the database by hand.
 *
 * The driver itself (`STORAGE_DRIVER`) is not reachable from here at all — it is
 * environment-only, so there is no local↔s3 control in the admin panel to
 * guard.
 */

/** The currently effective values, settings row resolved over environment. */
export interface EffectiveS3Location {
  endpoint: string | undefined
  region: string | undefined
  bucket: string
}

/** The topology fields a submission may carry. Credentials are not among them. */
export interface SubmittedS3Location {
  endpoint?: string
  region?: string
  bucket?: string
}

/** Trailing slashes and padding are cosmetic and must not read as a move. */
function normalize(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "")
}

/**
 * `null` when the edit is safe, otherwise a message naming the field.
 *
 * The message NEVER quotes the submitted value: an endpoint may carry
 * credentials in its userinfo, and a rejected value echoed into a response is a
 * credential in a log and a support ticket.
 */
export function rejectTopologyChange(
  current: EffectiveS3Location,
  submitted: SubmittedS3Location,
): string | null {
  const fields: { label: string; now: string | undefined; next: string | undefined }[] = [
    { label: "bucket", now: current.bucket, next: submitted.bucket },
    { label: "endpoint", now: current.endpoint, next: submitted.endpoint },
    { label: "region", now: current.region, next: submitted.region },
  ]

  const moved: string[] = []
  for (const { label, now, next } of fields) {
    // Absent means "not part of this submission". Blank means "clear this
    // override and fall back to the environment variable", which is this form's
    // established meaning everywhere else — neither is a request to relocate.
    if (next === undefined || next.trim() === "") continue

    const before = normalize(now)
    // Nothing configured yet is not a relocation: there is nothing to relocate
    // FROM. A fresh install setting its bucket for the first time must work.
    if (before === "") continue

    if (normalize(next) !== before) moved.push(label)
  }

  if (moved.length === 0) return null

  const which = moved.join(", ")
  return (
    `Changing the storage ${which} would point FlowCMS at a different location, ` +
    `leaving every existing file behind. Moving storage is a migration, not a settings edit, ` +
    `and it is not available yet. Credentials for the current location can still be updated here.`
  )
}
