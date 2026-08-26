import { consumeRateLimit, resetRateLimit } from "../RateLimit/RateLimiter"

/**
 * Brute-force protection for credential sign-in.
 *
 * Lives beside the Credentials provider rather than in a route handler on
 * purpose. `src/proxy.ts` only runs its auth branch on the admin namespace, so it never sees
 * `/api/auth/callback/credentials` — anything enforced there would be enforced
 * on the login *page* and not on the endpoint that actually checks passwords.
 * The only place every sign-in attempt provably passes through is
 * `authorize()`, so that is where the ceiling goes.
 */

/**
 * Two independent windows, because they defend against different attacks:
 *
 *   - PER EMAIL stops a slow, distributed password-spray against one known
 *     account. It is the tighter of the two, because a legitimate person does
 *     not need eight tries at their own password in a quarter of an hour.
 *   - PER IP stops one host working through many accounts. It is the looser of
 *     the two, because a whole office can share one NAT address and locking
 *     that out is a self-inflicted outage.
 *
 * Both windows are deliberately short. The goal is to make automated guessing
 * uneconomic, not to lock a human out of their own admin panel for an hour
 * because they fat-fingered a password.
 */
export const LOGIN_WINDOW_SECONDS = 15 * 60
export const LOGIN_MAX_PER_EMAIL = 8
export const LOGIN_MAX_PER_IP = 20

/** Extracted for tests and so the header precedence is stated once. */
export function clientIpFromHeaders(headers: Headers): string {
  // x-forwarded-for is a comma-separated chain; the first entry is the original
  // client as seen by the outermost proxy.
  const forwarded = headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  return headers.get("x-real-ip")?.trim() || "unknown"
}

/**
 * Emails are normalised so `Alice@Example.com` and `alice@example.com` share a
 * budget — otherwise case alone multiplies the allowance.
 */
function emailKey(email: string): string {
  return `login:email:${email.trim().toLowerCase()}`
}

function ipKey(ip: string): string {
  return `login:ip:${ip}`
}

export interface LoginAttemptIdentity {
  email: string
  ip: string
}

export interface LoginThrottleResult {
  limited: boolean
  retryAfterSeconds: number
}

/**
 * Records one attempt and reports whether the caller has exhausted either
 * window.
 *
 * Called BEFORE the user lookup and BEFORE the password comparison, which
 * matters twice over:
 *
 *   1. A throttled request never reaches bcrypt, so an attacker cannot use the
 *      login endpoint as a CPU-exhaustion primitive.
 *   2. The response is identical whether or not the account exists, because at
 *      this point the code has not looked.
 *
 * Both counters are consumed on every attempt so that a caller cannot dodge the
 * IP budget by rotating the email, or the email budget by rotating the proxy.
 */
export async function registerLoginAttempt(
  identity: LoginAttemptIdentity
): Promise<LoginThrottleResult> {
  const [byEmail, byIp] = await Promise.all([
    consumeRateLimit({
      key: emailKey(identity.email),
      limit: LOGIN_MAX_PER_EMAIL,
      windowSeconds: LOGIN_WINDOW_SECONDS,
    }),
    consumeRateLimit({
      key: ipKey(identity.ip),
      limit: LOGIN_MAX_PER_IP,
      windowSeconds: LOGIN_WINDOW_SECONDS,
    }),
  ])

  const limited = byEmail.limited || byIp.limited
  return {
    limited,
    retryAfterSeconds: Math.max(byEmail.retryAfterSeconds, byIp.retryAfterSeconds),
  }
}

/**
 * Clears both counters after a successful sign-in.
 *
 * Without this, someone who mistyped their password twice would still be
 * carrying those attempts fifteen minutes later, and a shared office IP would
 * accumulate every colleague's typos until it tripped.
 */
export async function clearLoginAttempts(identity: LoginAttemptIdentity): Promise<void> {
  await Promise.all([
    resetRateLimit(emailKey(identity.email)),
    resetRateLimit(ipKey(identity.ip)),
  ])
}
