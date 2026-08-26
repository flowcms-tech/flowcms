#!/usr/bin/env node
/**
 * EPHEMERAL TEST SECRETS, generated inside the job that uses them.
 *
 * FlowCMS's CI must never depend on a production secret, and it must never
 * carry a reusable one in workflow YAML. Both rules point at the same
 * implementation: generate fresh random values at the start of the job, mask
 * them so a later step cannot echo one into the log, and let them die with the
 * runner.
 *
 * These values are cryptographically random and therefore *valid* — that is the
 * point. `Framework/Config/deploymentSecret.ts` refuses placeholder-shaped
 * strings on purpose, so a workflow that exported AUTH_SECRET=test would be
 * testing the refusal path rather than the application.
 *
 * Nothing here reads a repository secret, and nothing here can. A job that
 * needs a real credential is a job that does not belong in this pipeline.
 *
 * Usage (inside GitHub Actions):
 *   node scripts/ci/generate-test-secrets.mjs >> "$GITHUB_ENV"
 *
 * Usage (locally, to see what it would export):
 *   node scripts/ci/generate-test-secrets.mjs --print
 *
 * The mask directives go to STDERR so that stdout stays a clean KEY=value
 * stream suitable for appending to $GITHUB_ENV. GitHub reads workflow commands
 * from both streams.
 */

import { randomBytes } from "node:crypto"

/** Base64 of 32 random bytes — the shape `docs/docker.md` documents. */
const secret = () => randomBytes(32).toString("base64")

/**
 * Every variable a FlowCMS CI job may need, and nothing else.
 *
 * NEXT_PUBLIC_BASE_URL is not a secret and is included because it is inlined at
 * build time: leaving it unset makes a built artifact differ from the one a
 * developer builds, for no reason anybody would notice until it mattered.
 */
export function buildTestEnvironment() {
  return {
    AUTH_SECRET: secret(),
    CAPTCHA_SECRET: secret(),
    PREVIEW_SECRET: secret(),
    FLOWCMS_SETUP_TOKEN: secret(),
    NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
    NEXT_TELEMETRY_DISABLED: "1",
  }
}

/** Which of the above are secret-shaped, and must therefore be masked. */
export const MASKED = [
  "AUTH_SECRET",
  "CAPTCHA_SECRET",
  "PREVIEW_SECRET",
  "FLOWCMS_SETUP_TOKEN",
]

const env = buildTestEnvironment()
const printOnly = process.argv.includes("--print")

for (const key of MASKED) {
  // Mask BEFORE the value is written to stdout. GitHub redacts a masked value
  // everywhere it appears afterwards, including in the $GITHUB_ENV echo that
  // debug logging produces.
  process.stderr.write(`::add-mask::${env[key]}\n`)
}

for (const [key, value] of Object.entries(env)) {
  if (printOnly && MASKED.includes(key)) {
    process.stdout.write(`${key}=<generated, ${value.length} chars, not shown>\n`)
    continue
  }
  // No multi-line values here, so plain KEY=value is correct and the heredoc
  // form $GITHUB_ENV also accepts would only add a way to get it wrong.
  process.stdout.write(`${key}=${value}\n`)
}
