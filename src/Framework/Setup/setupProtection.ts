import { consumeRateLimit } from "../RateLimit/RateLimiter"

/**
 * Brute-force protection for first-run setup.
 *
 * Built on the SAME limiter as credential login — `Framework/RateLimit/
 * RateLimiter` — and deliberately not a second subsystem. That module already
 * owns the decisions that matter: atomic `INCR` rather than read-modify-write,
 * a per-process in-memory fallback when Redis is absent, never throwing, and
 * failing open rather than turning a Redis outage into a lockout. Reproducing
 * any of that here would mean reproducing all of it, differently.
 */

/**
 * One window, keyed by client IP.
 *
 * Ten attempts per fifteen minutes is generous for a human filling in a form
 * they have one shot at, and irrelevant to an attacker: `FLOWCMS_SETUP_TOKEN`
 * is at least 24 high-entropy characters, so guessing it is not bounded by a
 * rate limit — it is bounded by arithmetic. This limit exists to stop noise and
 * to keep an unauthenticated caller from making the server hash passwords, not
 * to be the thing that protects the token.
 *
 * THERE IS DELIBERATELY NO GLOBAL WINDOW.
 *
 * A counter shared across all callers would let anyone on the internet exhaust
 * it and lock the operator out of their own first-run setup — a denial of
 * service against the one action that cannot be retried later from somewhere
 * else. It would buy nothing in exchange, for the reason above.
 */
export const SETUP_MAX_ATTEMPTS_PER_IP = 10
export const SETUP_WINDOW_SECONDS = 15 * 60

/**
 * Same header precedence as `loginProtection.clientIpFromHeaders`, restated
 * rather than imported so this module does not depend on the login surface.
 */
export function setupClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  return headers.get("x-real-ip")?.trim() || "unknown"
}

export interface SetupThrottleResult {
  limited: boolean
  retryAfterSeconds: number
}

/**
 * Record one setup attempt and report whether this caller is out of budget.
 *
 * Consumed BEFORE the token comparison and before any parsing, so a throttled
 * request costs this process one counter increment and never reaches bcrypt.
 * Successful attempts are not exempted and are not reset: setup succeeds once
 * in an installation's life, after which the endpoint is gone, so there is no
 * legitimate caller left whose budget would matter.
 */
export async function registerSetupAttempt(ip: string): Promise<SetupThrottleResult> {
  const result = await consumeRateLimit({
    key: `setup:ip:${ip}`,
    limit: SETUP_MAX_ATTEMPTS_PER_IP,
    windowSeconds: SETUP_WINDOW_SECONDS,
  })
  return { limited: result.limited, retryAfterSeconds: result.retryAfterSeconds }
}
