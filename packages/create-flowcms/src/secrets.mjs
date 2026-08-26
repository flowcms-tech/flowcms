import { randomBytes } from "node:crypto"

/**
 * Deployment secrets, for Phase 7.4's configuration step.
 *
 * FlowCMS requires `AUTH_SECRET` and `CAPTCHA_SECRET` to be strong, and Phase
 * 7.1.2 established what happens when one is not: a weak `AUTH_SECRET` fails
 * OPEN and SILENT — the site works, including for anyone who can read the
 * placeholder it was copied from. Generation is the installer's job precisely
 * so no operator ever picks one by hand.
 *
 * 32 bytes from `crypto.randomBytes`, base64url. 256 bits, well past the
 * application's floor, with no padding characters to lose in a `.env` file or
 * a shell.
 *
 * USED BY SCAFFOLDING SINCE 7.4: `resolveConfig` calls it (via its injectable
 * `generateSecrets` dependency) to fill `AUTH_SECRET` and `CAPTCHA_SECRET` in
 * the generated `.env`. It was written one phase ahead of that, unused, so the
 * compatibility test could exist first — and nothing prints a generated value,
 * then or now.
 *
 * That test is still the point: the CLI is a standalone package and cannot
 * import `@/Framework/…`, so the only way to know its output satisfies the
 * application's policy is to check it where both are reachable —
 * `tests/scaffolder/secretGeneration.test.ts` runs 200 generated values through
 * the real `classifyDeploymentSecret`.
 *
 * What must never appear here: `Math.random`, a timestamp, a hostname, a
 * counter, or a constant. Each of those has shipped in somebody's installer,
 * and each turns "every deployment has its own key" into "every deployment has
 * the same key, or one you can guess from when it was created".
 */

/** Bytes of entropy. Not configurable: a knob here is a knob to turn down. */
const SECRET_BYTES = 32

export function generateDeploymentSecret() {
  return randomBytes(SECRET_BYTES).toString("base64url")
}
