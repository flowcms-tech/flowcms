/**
 * The shared policy for env-only, high-entropy deployment secrets.
 *
 * FlowCMS has several: `CAPTCHA_SECRET`, `FLOWCMS_SETUP_TOKEN`, and — by the
 * same standard, though it is validated by Compose rather than here —
 * `AUTH_SECRET`. They protect different things and they all answer the same
 * question first: *is this string actually a secret, or is it the placeholder
 * somebody copied out of the documentation?*
 *
 * Phase 7.1 wrote this policy inside `Framework/Setup/setupToken.ts`. Phase
 * 7.1.1 needed it again for `CAPTCHA_SECRET` and extracted it here rather than
 * copying it, because two copies of a security rule are two rules that drift —
 * and the one that drifts is always the one nobody is looking at.
 *
 * WHAT THIS MODULE WILL NOT DO
 *
 * It never returns, formats, logs or embeds the value it judged. A
 * configuration error that quotes the secret has moved it into a log
 * aggregator, a screenshot and a support ticket. It reports the RULE that was
 * broken, never the string that broke it, and never a measurement of that
 * string either — "your secret is 5 characters" is a slow oracle for anyone who
 * can read the message.
 *
 * Dependency-free on purpose: it is imported by a route handler, by readiness,
 * by startup validation and by the first-run prerequisites, and nothing it
 * pulls in should follow it into any of those.
 */

/**
 * Length is the entropy proxy. 24 characters sits comfortably below the 43 a
 * 32-byte base64url secret produces and comfortably above anything a human
 * invents by hand.
 *
 * Deliberately NOT a password-complexity rule. Requiring an uppercase letter
 * and a symbol would reject a perfect 32-byte random secret that happened to
 * contain neither, and push operators toward memorable — which is to say
 * guessable — values instead.
 */
export const MIN_DEPLOYMENT_SECRET_LENGTH = 24

/**
 * Length alone is not enough: `"ab"` repeated twenty times is 42 characters and
 * about one bit. Eight distinct characters is a floor every real random secret
 * clears without thinking and every degenerate one fails.
 */
export const MIN_DEPLOYMENT_SECRET_DISTINCT_CHARS = 8

/**
 * Substrings that mean "this came from documentation, not from a random number
 * generator".
 *
 * Matched against the lowercased value, because the failure this catches is an
 * operator who copied a placeholder and appended something to make it long
 * enough — or, far more often, who copied `.env.example` to `.env` and changed
 * only the variables the startup errors complained about.
 *
 * `.env.example` ships `replace-me-with-32-random-bytes-base64`, which is 38
 * characters and would otherwise sail through every rule above. A test reads
 * that file and asserts this list still rejects it.
 */
const PLACEHOLDER_MARKERS = [
  "changeme",
  "change-me",
  "change_me",
  "replace-me",
  "replace_me",
  "replaceme",
  "your-secret",
  "your_secret",
  "your-setup-token",
  "your_setup_token",
  "setup-token-here",
  "secret-here",
  "placeholder",
  "example",
  "insecure",
  "password",
  "xxxxxxxx",
  // Added in Phase 7.1.2. `AUTH_SECRET=default-secret-...` is a shape people
  // reach for, and seven specific characters in sequence will not appear in a
  // base64url value by accident — the denylist has to stay narrow enough that
  // real random secrets are never rejected.
  "default",
]

/**
 * Markers too SHORT to be matched as a bare substring.
 *
 * The rule stated above — that a marker must be long enough not to occur in a
 * random base64url value by accident — was violated by its own list. `todo` is
 * FOUR characters, and `secretGeneration.test.ts` generates 200 secrets and
 * classifies each one: roughly once in a few hundred CI runs, one of them
 * contains `todo` and a perfectly good random secret is rejected as a
 * placeholder. It surfaced on windows-2022 first, but nothing about it is
 * platform-specific — that is only where the dice landed.
 *
 * Detection is NOT dropped, it is anchored. A real lazy value is `todo`, or
 * `todo-todo-todo-…`, where the marker sits at an edge or beside a separator.
 * A random secret has it wedged between other base64url characters, which is
 * exactly what the boundary rejects.
 */
const SHORT_PLACEHOLDER_MARKERS = ["todo"]

/** `marker` delimited by a string edge or any non-alphanumeric character. */
function containsDelimited(lowered: string, marker: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${marker}([^a-z0-9]|$)`).test(lowered)
}

export type DeploymentSecretState =
  /** Not configured at all. The caller decides what that means for its feature. */
  | "missing"
  /** Configured, and too weak to be worth the name. */
  | "unsafe"
  /** Configured and acceptable. */
  | "usable"

export interface DeploymentSecretVerdict {
  state: DeploymentSecretState
  /**
   * Why it was rejected, in terms of the RULE. Null when usable, and null when
   * missing — "it is not set" needs no elaboration here, and each caller words
   * that case for its own feature.
   */
  reason: string | null
}

/**
 * Judge a configured secret without ever reproducing it.
 *
 * Note what is NOT here: any notion of which variable this is. That belongs to
 * the caller, which knows what breaks when the secret is absent and can say so
 * in words an operator can act on.
 */
export function classifyDeploymentSecret(
  configured: string | undefined | null,
): DeploymentSecretVerdict {
  const value = (configured ?? "").trim()

  if (value.length === 0) return { state: "missing", reason: null }

  if (value.length < MIN_DEPLOYMENT_SECRET_LENGTH) {
    return {
      state: "unsafe",
      reason: `it must be at least ${MIN_DEPLOYMENT_SECRET_LENGTH} characters`,
    }
  }

  if (new Set(value).size < MIN_DEPLOYMENT_SECRET_DISTINCT_CHARS) {
    return {
      state: "unsafe",
      reason:
        `it must contain at least ${MIN_DEPLOYMENT_SECRET_DISTINCT_CHARS} distinct characters ` +
        "— generate a random value rather than a repeated pattern",
    }
  }

  const lowered = value.toLowerCase()
  const looksLikePlaceholder =
    PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker)) ||
    SHORT_PLACEHOLDER_MARKERS.some((marker) => containsDelimited(lowered, marker))

  if (looksLikePlaceholder) {
    return {
      state: "unsafe",
      reason: "it looks like a placeholder from the documentation — generate a random value",
    }
  }

  return { state: "usable", reason: null }
}

/** The command every operator-facing message should point at. */
export const GENERATE_SECRET_HINT =
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
