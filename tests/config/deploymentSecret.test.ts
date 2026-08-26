import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  MIN_DEPLOYMENT_SECRET_DISTINCT_CHARS,
  MIN_DEPLOYMENT_SECRET_LENGTH,
  classifyDeploymentSecret,
} from "@/Framework/Config/deploymentSecret"

/**
 * The shared policy for env-only, high-entropy deployment secrets.
 *
 * Extracted in Phase 7.1.1 from `Framework/Setup/setupToken.ts`, which invented
 * it in 7.1, because `CAPTCHA_SECRET` needs the same judgement and a second
 * copy of a security rule is a second rule that can drift.
 *
 * It answers exactly one question — "is this string a real secret?" — and never
 * reproduces the string in doing so.
 */

/** 32 bytes of base64url, the shape `.env.example` tells operators to generate. */
const GOOD = "K7mQx2vB9pLnR4tZ8sWdF6hJ3yC5aE1gN0uT7iO2kM4"

describe("what counts as configured", () => {
  it("treats unset, empty and whitespace as MISSING", () => {
    // Missing is its own state, not a weak secret and not permission. The
    // caller decides what missing means for its feature.
    for (const value of [undefined, null, "", "   ", "\t\n"]) {
      expect(classifyDeploymentSecret(value).state, JSON.stringify(value)).toBe("missing")
    }
  })

  it("accepts a high-entropy secret", () => {
    expect(classifyDeploymentSecret(GOOD).state).toBe("usable")
  })
})

describe("what counts as unsafe", () => {
  it("refuses anything shorter than the minimum", () => {
    expect(classifyDeploymentSecret("a1B2c3D4e5F6g7").state).toBe("unsafe")
  })

  it("refuses a long secret with almost no distinct characters", () => {
    // Length alone is a poor entropy proxy: 42 characters and about one bit.
    const repetitive = "ababababababababababababababababababababab"
    expect(repetitive.length).toBeGreaterThanOrEqual(MIN_DEPLOYMENT_SECRET_LENGTH)
    expect(new Set(repetitive).size).toBeLessThan(MIN_DEPLOYMENT_SECRET_DISTINCT_CHARS)
    expect(classifyDeploymentSecret(repetitive).state).toBe("unsafe")
  })

  it.each([
    "changeme",
    "change-me-please-to-something-else",
    "replace-me-with-32-random-bytes-base64",
    "your-secret-here-please-change-this",
    "flowcms-placeholder-secret-value-here",
    "insecure-development-secret-value-x",
  ])("refuses the documentation placeholder %s", (placeholder) => {
    // The failure this catches: an operator copies `.env.example` to `.env`,
    // the file's own sample value is long enough, and the deployment ships
    // with a secret that is published in the repository.
    expect(classifyDeploymentSecret(placeholder).state).toBe("unsafe")
  })

  it("refuses the exact value .env.example ships for CAPTCHA_SECRET", () => {
    // Read from the tracked file, so this cannot go stale if the sample changes.
    const example = readFileSync(".env.example", "utf8")
    const sample = example.match(/^CAPTCHA_SECRET=(.*)$/m)?.[1] ?? ""
    expect(sample.length, "the example must ship a non-empty placeholder").toBeGreaterThan(0)
    expect(classifyDeploymentSecret(sample).state).toBe("unsafe")
  })
})

describe("it never reproduces the secret", () => {
  it("keeps the value out of its own explanation", () => {
    const secretish = "ababababababababababababababababababababab"
    const result = classifyDeploymentSecret(secretish)
    expect(result.state).toBe("unsafe")
    expect(result.reason).toBeTruthy()
    expect(result.reason).not.toContain(secretish)
    expect(JSON.stringify(result)).not.toContain(secretish)
  })

  it("returns a rule, not a measurement of the value", () => {
    const result = classifyDeploymentSecret("short")
    // The RULE may name the minimum. The value's own length must not appear as
    // a measurement — that is a slow oracle for anyone who can see the message.
    expect(result.reason).toContain(String(MIN_DEPLOYMENT_SECRET_LENGTH))
    expect(result.reason).not.toMatch(/\b5\b/)
  })

  it("carries only a state and a reason — nothing derived from the value", () => {
    const result = classifyDeploymentSecret(GOOD)
    expect(Object.keys(result).sort()).toEqual(["reason", "state"])
    expect(result.reason).toBeNull()
  })
})

describe("the policy itself", () => {
  it("stays in entropy territory rather than password territory", () => {
    expect(MIN_DEPLOYMENT_SECRET_LENGTH).toBeGreaterThanOrEqual(24)
  })

  it("imposes no character-class requirement", () => {
    // A 32-byte base64url secret with no uppercase and no symbol is excellent.
    // Rejecting it would push operators toward memorable, guessable values.
    expect(classifyDeploymentSecret("k7mqx2vb9plnr4tz8swdf6hj3yc5ae1gn0ut7io2km4").state).toBe(
      "usable",
    )
  })
})
