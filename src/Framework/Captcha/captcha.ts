import { createHmac, randomInt, timingSafeEqual } from "crypto"
import { consumeRateLimit } from "../RateLimit/RateLimiter"

const CODE_LENGTH = 5
// No ambiguous chars (0/O, 1/I, etc.)
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

/**
 * How long a challenge stays answerable. Matches the cookie's `maxAge`, but the
 * cookie is only advisory — see the expiry note on `signCaptcha`.
 */
export const CAPTCHA_TTL_SECONDS = 300

/**
 * Name of the httpOnly cookie carrying the signed challenge.
 *
 * Declared here rather than in auth.ts so that /api/captcha can issue the
 * cookie without importing the full NextAuth instance — and with it the
 * database client — just to learn a string.
 */
export const CAPTCHA_COOKIE_NAME = "captcha_token"

export function generateCaptchaCode(): string {
  let code = ""
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[randomInt(CODE_CHARS.length)]
  }
  return code
}

function sign(payload: string): string {
  const secret = process.env.CAPTCHA_SECRET
  if (!secret) throw new Error("CAPTCHA_SECRET is not set")
  return createHmac("sha256", secret).update(payload).digest("hex")
}

/**
 * Produces `<code>.<expiresAtMs>.<hmac>`.
 *
 * The expiry is INSIDE the signed payload, not just on the cookie.
 *
 * The cookie's `maxAge` is enforced by the browser, and a browser is exactly
 * what an attacker posting straight at the credentials endpoint is not using —
 * they control their own cookie jar and can keep replaying a captured value
 * forever. Signing the deadline moves the expiry from something the client is
 * asked to respect to something the server checks.
 */
export function signCaptcha(code: string, expiresAt?: number): string {
  const expiry = expiresAt ?? Date.now() + CAPTCHA_TTL_SECONDS * 1000
  const payload = `${code}.${expiry}`
  return `${payload}.${sign(payload)}`
}

/**
 * Verifies a captcha token against a submitted answer.
 *
 * Returns false rather than throwing on ANY failure, including an unset
 * `CAPTCHA_SECRET`. A verifier that throws would surface as a 500 from the
 * sign-in path, and "the login endpoint errors instead of denying" is a worse
 * outcome than "the login endpoint denies" — a misconfigured install should be
 * shut, not broken open or crashing.
 */
export function verifyCaptchaToken(
  token: string | undefined,
  submitted: string
): boolean {
  if (!token || !submitted) return false

  const parts = token.split(".")
  if (parts.length !== 3) return false
  const [code, expiryRaw, signature] = parts
  if (!code || !expiryRaw || !signature) return false

  let expected: string
  try {
    expected = sign(`${code}.${expiryRaw}`)
  } catch {
    return false
  }

  // Constant-time, matching previewToken.ts. Length is compared first because
  // timingSafeEqual throws on a length mismatch.
  const a = Buffer.from(signature, "utf8")
  const b = Buffer.from(expected, "utf8")
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false

  const expiry = Number(expiryRaw)
  if (!Number.isFinite(expiry) || Date.now() > expiry) return false

  return code.toUpperCase() === submitted.toUpperCase()
}

/**
 * Verifies a captcha AND burns it, so the same challenge cannot answer two
 * sign-in attempts.
 *
 * WHY THIS EXISTS SEPARATELY FROM COOKIE DELETION
 *
 * Single use used to be enforced by deleting the `captcha_token` cookie in a
 * server action. That only binds a client that honours Set-Cookie. The whole
 * point of moving verification into the Credentials provider is to defend the
 * path where the caller is a script, and a script keeps its cookie. So the
 * "already used" fact has to live on the server.
 *
 * Implemented on the atomic rate limiter with `limit: 1` — the first call
 * increments to 1 and passes, every later call increments past the limit and
 * fails. Entries expire with the challenge itself, so nothing accumulates.
 *
 * A WRONG ANSWER DOES NOT BURN THE CHALLENGE. Consumption happens only after
 * the answer verifies, so a typo costs a retry rather than a page refresh.
 * Guessing is bounded by the login rate limiter, not by this.
 *
 * When Redis is unavailable this inherits the limiter's per-process fallback:
 * still single-use within an instance, not coordinated across replicas.
 */
export async function consumeCaptcha(
  token: string | undefined,
  submitted: string
): Promise<boolean> {
  if (!verifyCaptchaToken(token, submitted)) return false

  // Key on the signature: it is unique per issued challenge, fixed-length, and
  // not the answer, so nothing sensitive lands in a Redis key name.
  const signature = token!.split(".")[2]
  const { limited } = await consumeRateLimit({
    key: `captcha:${signature}`,
    limit: 1,
    windowSeconds: CAPTCHA_TTL_SECONDS,
  })

  return !limited
}
