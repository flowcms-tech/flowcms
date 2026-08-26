import {
  GENERATE_SECRET_HINT,
  classifyDeploymentSecret,
  type DeploymentSecretState,
} from "@/Framework/Config/deploymentSecret"

/**
 * THE SINGLE AUTHORITY ON WHETHER `AUTH_SECRET` IS USABLE.
 *
 * `AUTH_SECRET` signs and encrypts every session JWT. It is the one value that
 * decides whether a cookie presented to FlowCMS was issued by FlowCMS, so a
 * weak or published value is not a hardening gap — it is unauthenticated
 * administrator access to the whole installation.
 *
 * WHAT WAS WRONG BEFORE PHASE 7.1.2
 *
 * Nothing checked it. `.env.example` shipped
 * `replace-me-with-32-random-bytes-base64`, Compose's `${AUTH_SECRET:?}` guard
 * only proved that *something* was set, and no file under `src/` read the
 * variable at all — Auth.js reads it straight from the environment. So copying
 * the example file produced a working CMS whose session-signing key is
 * published in this repository.
 *
 * That failure mode is the opposite of `CAPTCHA_SECRET`'s in Phase 7.1.1. A
 * missing captcha secret failed CLOSED and LOUD: nobody could sign in. A weak
 * auth secret fails OPEN and SILENT: everything works, including for anyone who
 * can read the repository.
 *
 * WHY THIS MODULE HAS NO ENTROPY RULES OF ITS OWN
 *
 * The floor lives in `Framework/Config/deploymentSecret`, shared with
 * `CAPTCHA_SECRET` and `FLOWCMS_SETUP_TOKEN`. Auth.js derives its encryption
 * key from this value by HKDF and recommends 32 random bytes, which the shared
 * floor already covers; nothing about Auth.js justifies a second, divergent
 * rule. What lives HERE is only the wording — what breaks, and what it costs to
 * fix.
 *
 * DEPENDENCY-FREE, and that is load-bearing: `auth.config.ts` imports this, and
 * `auth.config.ts` is pulled into the `src/proxy.ts` bundle, which must never
 * transitively reach the database client or `server-only`.
 */

export type AuthSecretState = DeploymentSecretState

export interface AuthSecretVerdict {
  state: AuthSecretState
  /** True only for `usable`. */
  ok: boolean
  /**
   * Operator-facing explanation: what is wrong, what it risks, how to fix it,
   * and what fixing it costs. Never the value, never a prefix, never a hash,
   * never a measurement of its length.
   */
  message: string | null
}

/**
 * What is at stake, and what the fix costs.
 *
 * The rotation warning is part of the message on purpose: the operator's next
 * action is to replace the value and restart, and being signed out immediately
 * afterwards should be an expectation rather than a surprise that makes them
 * wonder whether they broke something.
 */
const CONSEQUENCE =
  "It signs every session token, so a weak or published value lets anyone forge an " +
  "administrator session. Replacing it invalidates all existing sessions and signs " +
  "everyone out, which is expected and is safer than continuing."

export function classifyAuthSecret(configured: string | undefined | null): AuthSecretVerdict {
  const verdict = classifyDeploymentSecret(configured)

  if (verdict.state === "usable") return { state: "usable", ok: true, message: null }

  if (verdict.state === "missing") {
    return {
      state: "missing",
      ok: false,
      message:
        `AUTH_SECRET is required and is not set. ${CONSEQUENCE} ` +
        `Generate one with: ${GENERATE_SECRET_HINT}`,
    }
  }

  return {
    state: "unsafe",
    ok: false,
    message:
      `AUTH_SECRET is not usable: ${verdict.reason}. ${CONSEQUENCE} ` +
      `Generate one with: ${GENERATE_SECRET_HINT}`,
  }
}

/**
 * The configured value and its verdict, captured ONCE at module load — before
 * the withholding below can remove it.
 *
 * Resolved once rather than per call, matching `Framework/Config/adminPath.ts`
 * and for the same reason: a deployment secret cannot change without a restart,
 * so re-reading it would only invite the value to differ between two callers in
 * the same process.
 */
/**
 * Marker recording that a rejected value was withheld, so the DIAGNOSIS
 * survives the withholding.
 *
 * Next loads this module separately in each bundle it reaches — the proxy
 * bundle via `auth.config.ts`, and the server bundle via readiness and the
 * setup prerequisites. Whichever loads first deletes the variable, so every
 * later copy would capture `undefined` and report `missing`: an operator who
 * set a weak value would be told they had set nothing, and would go looking for
 * the wrong problem. That is precisely the diagnosis failure this whole phase
 * exists to fix, so it is not acceptable collateral.
 *
 * The marker carries a single character. It never carries the value, a prefix
 * of it, a hash of it, or its length — only the fact that something was
 * rejected.
 */
const WITHHELD_MARKER = "FLOWCMS_AUTH_SECRET_WITHHELD"

const CONFIGURED_AT_LOAD = process.env.AUTH_SECRET

/** What a later bundle reports once the value has already been withheld. */
const ALREADY_WITHHELD: AuthSecretVerdict = {
  state: "unsafe",
  ok: false,
  message:
    `AUTH_SECRET was set but rejected as unusable. ${CONSEQUENCE} ` +
    `Generate one with: ${GENERATE_SECRET_HINT}`,
}

const VERDICT_AT_LOAD: AuthSecretVerdict =
  CONFIGURED_AT_LOAD === undefined && process.env[WITHHELD_MARKER] === "1"
    ? // An earlier bundle already withheld a rejected value. Report that it was
      // rejected, not the absence it left behind.
      ALREADY_WITHHELD
    : classifyAuthSecret(CONFIGURED_AT_LOAD)

/**
 * WITHHOLD A REJECTED SECRET FROM AUTH.JS — the enforcing step, and it has to
 * be this rather than the obvious alternative.
 *
 * The first attempt supplied `secret: ""` in the Auth.js config, reasoning that
 * `""` is not nullish and so would survive next-auth's
 * `config.secret ?? (config.secret = process.env.AUTH_SECRET)`. It does survive
 * that. It does not survive what happens next: `@auth/core`'s own
 * `setEnvDefaults` runs immediately afterwards and says
 *
 *     if (!config.secret?.length) { config.secret = []; ...push(env.AUTH_SECRET) }
 *
 * — so an empty secret is treated as "not configured" and REFILLED from exactly
 * the environment variable being rejected. The Docker proof caught it: a
 * deployment running the repository's own placeholder still minted a valid
 * owner session.
 *
 * A guard inside `authorize()` would not be sufficient either, and that is the
 * more important point. The attack this defends against is not signing in — it
 * is forging the cookie. Someone who knows the signing key mints a session
 * token directly and never touches the credentials endpoint, so refusing
 * sign-in would leave the actual hole open. Only making the key unavailable to
 * the token layer closes both.
 *
 * So the rejected value is removed from the environment. Nothing is generated
 * and nothing is substituted: Auth.js finds no secret, `assertConfig` raises
 * `MissingSecret`, and every auth action fails closed — no session can be
 * signed, and no forged one can be verified.
 *
 * Diagnostics survive because the verdict was captured above. Readiness still
 * reports `unsafe` rather than degrading to `missing`, so the operator is told
 * that they set something and it was rejected, not that they forgot.
 *
 * This is the ONLY mutation of `process.env` in the codebase, it removes a
 * value rather than inventing one, and it happens once at module load.
 */
if (!VERDICT_AT_LOAD.ok && CONFIGURED_AT_LOAD !== undefined) {
  delete process.env.AUTH_SECRET
  // So the next bundle to load this module reports "rejected" rather than
  // "never set". See the marker's note above.
  process.env[WITHHELD_MARKER] = "1"
}

/**
 * The deployment's verdict, as captured at startup.
 *
 * Callers that want to judge an arbitrary value — tests, and any future
 * installer — use `classifyAuthSecret` directly; this one answers for the
 * running process.
 */
export function getAuthSecretConfig(): AuthSecretVerdict {
  return VERDICT_AT_LOAD
}

/** Convenience for callers that only need the boolean. */
export function isAuthSecretConfigured(): boolean {
  return VERDICT_AT_LOAD.ok
}

/**
 * What Auth.js is given as its `secret`: the configured value when it passes,
 * and `undefined` when it does not.
 *
 * `undefined` is honest here rather than load-bearing. Auth.js would normally
 * fall back to `process.env.AUTH_SECRET` — but the block above has already
 * removed a rejected value from the environment, so there is nothing to fall
 * back to and `assertConfig` raises `MissingSecret`. Supplying it explicitly
 * still earns its place: it states, at the one point auth configuration is
 * assembled, that this value went through the policy.
 *
 * NOTHING IS INVENTED, in either branch. The application must never generate a
 * secret at runtime: it would sign every user out on each restart and give each
 * replica a different key, so a session issued by one instance would be
 * rejected by the next. Generation belongs to deployment tooling.
 */
export function resolveAuthSecret(): string | undefined {
  return VERDICT_AT_LOAD.ok ? CONFIGURED_AT_LOAD : undefined
}

/**
 * One redacted operator-facing line for the server log.
 *
 * Callers use this rather than formatting their own, so the wording — and the
 * guarantee that the value never appears — lives in one place.
 */
export function logAuthSecretProblem(where: string, verdict: AuthSecretVerdict): void {
  if (verdict.ok) return
  console.error(`[flowcms:auth] ${where}: ${verdict.message}`)
}
