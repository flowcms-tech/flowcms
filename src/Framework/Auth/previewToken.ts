import { createHmac, timingSafeEqual } from "crypto"

/**
 * Shareable draft-preview links.
 *
 * An HMAC over `postId + expiry`, mirroring the captcha flow already proven in
 * this codebase, rather than a token table. The trade is explicit and worth
 * stating because the UI has to state it too: with no stored token there is
 * nothing to revoke individually. Rotating PREVIEW_SECRET invalidates every
 * outstanding link at once, and that is the only revocation there is.
 *
 * A table would buy per-link revocation and an access log. It would also cost a
 * migration, a cleanup job for expired rows, and a second concept of "a thing
 * that grants access" alongside the session. For links that expire in at most
 * 30 days and only ever expose a draft the sender chose to share, that is the
 * wrong trade.
 */

export const PREVIEW_EXPIRY_OPTIONS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
} as const

export type PreviewExpiry = keyof typeof PREVIEW_EXPIRY_OPTIONS

export const PREVIEW_EXPIRY_LABELS: Record<PreviewExpiry, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
}

export function isPreviewExpiry(value: unknown): value is PreviewExpiry {
  return typeof value === "string" && value in PREVIEW_EXPIRY_OPTIONS
}

/**
 * Fails CLOSED when PREVIEW_SECRET is unset.
 *
 * Returning null rather than falling back to another secret or to a constant is
 * the whole security posture of this module: an unconfigured deployment mints
 * no tokens and accepts none, so the worst case is "the feature doesn't work",
 * never "every token verifies". A fallback secret would be the same as no
 * secret, discovered much later.
 */
function secret(): string | null {
  return process.env.PREVIEW_SECRET || null
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("hex")
}

/**
 * `<expiryMs>.<hmac>` — the expiry travels in the token rather than being
 * looked up, which is what makes the table unnecessary. It is inside the signed
 * payload, so extending it means forging the signature.
 */
export function createPreviewToken(postId: string, expiry: PreviewExpiry): string | null {
  const key = secret()
  if (!key) return null

  const expiresAt = Date.now() + PREVIEW_EXPIRY_OPTIONS[expiry]
  const payload = `${postId}.${expiresAt}`
  return `${expiresAt}.${sign(payload, key)}`
}

/**
 * Verifies a token against one specific post.
 *
 * The postId is an input, not something read out of the token: a token minted
 * for post A must never unlock post B, and binding it at verification time is
 * what guarantees that even if the caller passes the id from the URL.
 */
export function verifyPreviewToken(postId: string, token: string | null | undefined): boolean {
  const key = secret()
  if (!key || !token) return false

  const separator = token.lastIndexOf(".")
  if (separator <= 0) return false

  const expiresAtRaw = token.slice(0, separator)
  const signature = token.slice(separator + 1)

  const expiresAt = Number(expiresAtRaw)
  if (!Number.isFinite(expiresAt)) return false
  // Expiry is checked before the HMAC so an expired token is cheap to reject,
  // and after parsing so a malformed one never reaches the comparison.
  if (expiresAt <= Date.now()) return false

  const expected = sign(`${postId}.${expiresAt}`, key)
  if (expected.length !== signature.length) return false

  // Constant-time: a plain === leaks how many leading characters matched, which
  // over enough attempts is enough to reconstruct a signature.
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"))
  } catch {
    // Non-hex input makes Buffer.from produce a shorter buffer, which
    // timingSafeEqual rejects by throwing. That is a malformed token.
    return false
  }
}

/** Header every preview response must carry. A leaked preview URL getting
 *  indexed is the entire risk of this feature, and it is handled at the
 *  response level rather than by convention. */
export const PREVIEW_RESPONSE_HEADERS = {
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Cache-Control": "private, no-store, max-age=0",
} as const

/** Expiry as a wall-clock timestamp, for the "expires on ..." line in the UI.
 *  Read straight off the token so the label can never disagree with what the
 *  verifier will do. */
export function previewTokenExpiresAt(token: string): Date | null {
  const separator = token.lastIndexOf(".")
  if (separator <= 0) return null
  const expiresAt = Number(token.slice(0, separator))
  return Number.isFinite(expiresAt) ? new Date(expiresAt) : null
}
