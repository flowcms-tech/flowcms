import { createHash, timingSafeEqual } from "node:crypto"
import {
  MIN_DEPLOYMENT_SECRET_DISTINCT_CHARS,
  MIN_DEPLOYMENT_SECRET_LENGTH,
  classifyDeploymentSecret,
} from "@/Framework/Config/deploymentSecret"

/**
 * `FLOWCMS_SETUP_TOKEN` — the deployment secret that gates public first-run
 * setup.
 *
 * A freshly deployed FlowCMS is, until someone completes setup, a machine on
 * the internet that will hand ownership to whoever asks first. This token is
 * what makes "whoever asks first" mean "whoever deployed it".
 *
 * IT IS ENVIRONMENT, NOT DATABASE. Nothing here writes the token anywhere — not
 * hashed, not salted, not at all. There is nothing to store: the environment is
 * the authority for exactly as long as setup is open, and after that the token
 * is irrelevant because the endpoint is gone. A stored hash would be a
 * long-lived artefact of a short-lived secret.
 *
 * IT IS NEVER ECHOED. No function here returns, formats, logs or embeds the
 * configured value or the submitted one. `classifySetupToken` deliberately
 * reports a rule rather than a value, because a configuration error that quotes
 * the secret has moved it into a log file, a screenshot and a support ticket.
 *
 * IT NEVER TRAVELS IN A URL. The route accepts it in a POST body only. A query
 * string would put a deployment secret in browser history, proxy access logs,
 * and the Referer header of every link the page later renders.
 */

/**
 * Length is the entropy proxy. 24 characters is comfortably below the 43 a
 * 32-byte base64url token produces and comfortably above anything a human
 * invents by hand.
 *
 * This is deliberately NOT a password-complexity rule. Requiring an uppercase
 * letter and a symbol would reject a perfect 32-byte random token that happened
 * to contain neither, and push operators toward memorable — which is to say
 * guessable — values instead.
 */
export const MIN_SETUP_TOKEN_LENGTH = MIN_DEPLOYMENT_SECRET_LENGTH

/**
 * Length alone is not enough: `"ab"` repeated twenty times is 40 characters and
 * about one bit. Eight distinct characters is a floor that every real random
 * token clears without thinking and every degenerate one fails.
 */
export const MIN_SETUP_TOKEN_DISTINCT_CHARS = MIN_DEPLOYMENT_SECRET_DISTINCT_CHARS

// The placeholder denylist moved to Framework/Config/deploymentSecret in Phase
// 7.1.1, shared with CAPTCHA_SECRET. It is deliberately NOT left behind here as
// a second copy: a dead duplicate of a security list is the thing that gets
// edited when the live one does not.

export type SetupTokenState =
  /** No token configured. Web setup is locked; the app still boots. */
  | "missing"
  /** Configured, but too weak to defend the endpoint. Web setup refuses. */
  | "unsafe"
  /** Configured and acceptable. */
  | "usable"

export interface SetupTokenClassification {
  state: SetupTokenState
  /**
   * Operator-facing explanation for `missing` and `unsafe`, naming the RULE
   * that was broken and never the value that broke it. Null when usable.
   */
  message: string | null
}

/**
 * Judge the configured token without ever reproducing it.
 *
 * Called by the setup page (to explain why the form is locked), by the setup
 * API (to refuse before doing any work), and by the verifier below — so a
 * deployment running `FLOWCMS_SETUP_TOKEN=changeme` is not defended by nothing
 * while appearing to be defended by a token.
 */
export function classifySetupToken(configured: string | undefined | null): SetupTokenClassification {
  // The entropy rules live in Framework/Config/deploymentSecret, shared with
  // CAPTCHA_SECRET since Phase 7.1.1. Two copies of a security rule are two
  // rules that drift, and the one that drifts is the one nobody is looking at.
  // What stays HERE is the wording: only this module knows that a missing token
  // locks web setup rather than breaking it, and that an operator with server
  // access has bootstrap-owner.mjs instead.
  const verdict = classifyDeploymentSecret(configured)

  if (verdict.state === "missing") {
    return {
      state: "missing",
      message:
        "Web setup is locked because FLOWCMS_SETUP_TOKEN is not configured. " +
        "Set it to a long random value and restart, or create the first owner " +
        "on the server with scripts/bootstrap-owner.mjs.",
    }
  }

  if (verdict.state === "unsafe") {
    return {
      state: "unsafe",
      message: `FLOWCMS_SETUP_TOKEN is not usable: ${verdict.reason}.`,
    }
  }

  return { state: "usable", message: null }
}

/** Equal-length digest, so `timingSafeEqual` is usable at all. */
function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest()
}

/**
 * Constant-time comparison of a submitted token against the configured one.
 *
 * FAILS CLOSED on a missing or unsafe configured token. That matters more than
 * it looks: a naive `configured === supplied` would return true for two empty
 * strings, so an installation that forgot the variable would accept a caller
 * who also sent nothing — the exact deployment most in need of the guard.
 *
 * BOTH SIDES ARE HASHED FIRST, and that is the whole technique.
 * `timingSafeEqual` throws when its buffers differ in length, so comparing raw
 * tokens means either an exception on every wrong-length guess or a length
 * check before the comparison — and a length check is itself an oracle that
 * hands an attacker the token's length for free. Digesting first makes every
 * comparison 32 bytes against 32 bytes, so the only thing an attacker learns is
 * "no".
 *
 * Exact on case and whitespace. A deployment secret is copied, never typed, so
 * normalising it would only widen the set of accepted answers.
 */
export function verifySetupToken(
  configured: string | undefined | null,
  supplied: string | undefined | null,
): boolean {
  if (classifySetupToken(configured).state !== "usable") return false
  return timingSafeEqual(digest((configured ?? "").trim()), digest(supplied ?? ""))
}

/**
 * The configured token, read from the environment at call time.
 *
 * Deliberately NOT resolved once at module load, unlike the admin path: the
 * admin path must fail loudly at startup because every route depends on it,
 * whereas this variable is consulted by exactly one endpoint that only exists
 * before setup completes. Reading it per call also keeps it out of module state
 * where a heap dump or an accidental export could reach it.
 */
export function readConfiguredSetupToken(): string | undefined {
  return process.env.FLOWCMS_SETUP_TOKEN
}
