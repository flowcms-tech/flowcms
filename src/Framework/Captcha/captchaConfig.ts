import {
  GENERATE_SECRET_HINT,
  classifyDeploymentSecret,
  type DeploymentSecretState,
} from "@/Framework/Config/deploymentSecret"

/**
 * THE SINGLE AUTHORITY ON WHETHER `CAPTCHA_SECRET` IS USABLE.
 *
 * `CAPTCHA_SECRET` is **required for a functional production installation.**
 * There is no "CAPTCHA disabled" state in FlowCMS, and a missing secret must
 * never be read as one.
 *
 * WHY THIS MODULE EXISTS AT ALL
 *
 * The implementation was already correct and fail-closed: `signCaptcha()`
 * throws without a secret, and `verifyCaptchaToken()` returns false rather than
 * throwing past its caller. So an unset secret made login IMPOSSIBLE — not
 * unguarded. That is the right direction to fail.
 *
 * What was wrong was everything around it. `compose.yml` and `docs/docker.md`
 * told operators "absent disables the login CAPTCHA", which is false, and
 * nothing noticed the misconfiguration until the first sign-in attempt — by
 * which point first-run setup had already completed into an installation that
 * nobody could ever administer. That is the defect Phase 7.1.1 fixes: not the
 * cryptography, the *diagnosis*.
 *
 * Four callers ask this module and none of them restates the rule:
 *
 *   src/instrumentation.ts               logs loudly at startup
 *   src/Framework/Health/readiness.ts    fails readiness, reports a state
 *   src/app/api/captcha/route.ts         answers 503 instead of an opaque 500
 *   src/Framework/Setup/prerequisites.ts blocks first-run completion
 *
 * WHY THE SAME POLICY AS THE SETUP TOKEN
 *
 * The secret is an HMAC key. An attacker who can guess it can sign their own
 * challenge token — and the whole reason the browser's captcha cookie is
 * trusted is that only the server can produce that signature. A weak
 * `CAPTCHA_SECRET` therefore does not weaken the CAPTCHA, it removes it. So it
 * gets the same entropy floor as every other deployment secret, from
 * `Framework/Config/deploymentSecret`.
 */

export type CaptchaConfigState = DeploymentSecretState

export interface CaptchaConfigVerdict {
  state: CaptchaConfigState
  /** True only for `usable`. The one thing callers normally need. */
  ok: boolean
  /**
   * Operator-facing explanation for `missing` and `unsafe`: what is wrong, what
   * it breaks, and how to fix it. Never the value, never a prefix of it, never
   * a hash of it, and never a measurement of its length.
   */
  message: string | null
}

/**
 * What breaks. Stated in every message because "CAPTCHA_SECRET is invalid" does
 * not tell an operator that their admin panel is about to be unreachable.
 */
const CONSEQUENCE =
  "Without it, the login CAPTCHA cannot be issued or verified and nobody can sign in to the admin panel."

export function classifyCaptchaConfig(
  configured: string | undefined | null,
): CaptchaConfigVerdict {
  const verdict = classifyDeploymentSecret(configured)

  if (verdict.state === "usable") return { state: "usable", ok: true, message: null }

  if (verdict.state === "missing") {
    return {
      state: "missing",
      ok: false,
      message:
        "CAPTCHA_SECRET is required and is not set. " +
        `${CONSEQUENCE} Generate one with: ${GENERATE_SECRET_HINT}`,
    }
  }

  return {
    state: "unsafe",
    ok: false,
    message:
      `CAPTCHA_SECRET is not usable: ${verdict.reason}. ` +
      `${CONSEQUENCE} Generate one with: ${GENERATE_SECRET_HINT}`,
  }
}

/**
 * The configured secret, read at call time.
 *
 * Deliberately not resolved once at module load: reading it per call keeps it
 * out of module state, and lets a restart with a corrected value take effect
 * without anything else having to know it changed.
 */
export function readCaptchaSecret(): string | undefined {
  return process.env.CAPTCHA_SECRET
}

/** The live environment's verdict. */
export function getCaptchaConfig(): CaptchaConfigVerdict {
  return classifyCaptchaConfig(readCaptchaSecret())
}

/** Convenience for the callers that only need the boolean. */
export function isCaptchaConfigured(): boolean {
  return getCaptchaConfig().ok
}

/**
 * One redacted operator-facing line, for the server log.
 *
 * Callers use this instead of formatting their own, so the wording — and the
 * guarantee that the value never appears — lives in exactly one place.
 */
export function logCaptchaConfigProblem(where: string, verdict: CaptchaConfigVerdict): void {
  if (verdict.ok) return
  console.error(`[flowcms:captcha] ${where}: ${verdict.message}`)
}
