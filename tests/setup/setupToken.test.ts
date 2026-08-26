import { describe, expect, it } from "vitest"
import {
  MIN_SETUP_TOKEN_DISTINCT_CHARS,
  MIN_SETUP_TOKEN_LENGTH,
  classifySetupToken,
  verifySetupToken,
} from "@/Framework/Setup/setupToken"

/**
 * The deployment secret that gates public first-run setup.
 *
 * A fresh FlowCMS installation is, for a few minutes, a machine on the internet
 * that will hand ownership to whoever asks first. `FLOWCMS_SETUP_TOKEN` is what
 * makes "whoever asks first" mean "whoever deployed it".
 *
 * Every assertion here is about one of three properties: the token cannot be
 * absent-but-assumed, it cannot be weak-but-accepted, and comparing it cannot
 * leak it.
 */

/** 32 bytes of base64url — the shape `.env.example` tells operators to generate. */
const GOOD = "K7mQx2vB9pLnR4tZ8sWdF6hJ3yC5aE1gN0uT7iO2kM4"

describe("token configuration policy", () => {
  it("treats an unset token as MISSING, never as permission", () => {
    // The whole point: absent is not a fallback, and it is not an error either.
    // Web setup is locked and the application still boots.
    expect(classifySetupToken(undefined).state).toBe("missing")
    expect(classifySetupToken("").state).toBe("missing")
    expect(classifySetupToken("   ").state).toBe("missing")
  })

  it("accepts a high-entropy token", () => {
    expect(classifySetupToken(GOOD).state).toBe("usable")
  })

  it("refuses a token shorter than the minimum", () => {
    const short = "a1B2c3D4e5F6g7"
    expect(short.length).toBeLessThan(MIN_SETUP_TOKEN_LENGTH)
    expect(classifySetupToken(short).state).toBe("unsafe")
  })

  it("refuses a long token with almost no distinct characters", () => {
    // Length alone is a poor entropy proxy: this is 40 characters and two bits.
    const repetitive = "ababababababababababababababababababababab"
    expect(repetitive.length).toBeGreaterThanOrEqual(MIN_SETUP_TOKEN_LENGTH)
    expect(new Set(repetitive).size).toBeLessThan(MIN_SETUP_TOKEN_DISTINCT_CHARS)
    expect(classifySetupToken(repetitive).state).toBe("unsafe")
  })

  it.each([
    "changeme",
    "change-me-please-to-something-else",
    "replace-me-with-32-random-bytes-base64",
    "your-setup-token-here-please-change",
    "flowcms-setup-token-placeholder-value",
  ])("refuses the placeholder %s however long it is", (placeholder) => {
    expect(classifySetupToken(placeholder).state).toBe("unsafe")
  })

  it("never puts the configured value in its own explanation", () => {
    const secretish = "ababababababababababababababababababababab"
    const result = classifySetupToken(secretish)
    expect(result.state).toBe("unsafe")
    // An operator-facing configuration error that quotes the secret has moved
    // it into a log, a screenshot and a support ticket.
    expect(result.message).toBeTruthy()
    expect(result.message).not.toContain(secretish)
    expect(JSON.stringify(result)).not.toContain(secretish)
  })

  it("states the rule it enforced, so the operator can fix it", () => {
    const result = classifySetupToken("short")
    expect(result.message).toContain(String(MIN_SETUP_TOKEN_LENGTH))
  })

  it("keeps the minimum length in entropy territory, not password territory", () => {
    expect(MIN_SETUP_TOKEN_LENGTH).toBeGreaterThanOrEqual(24)
  })

  it("does not impose human password-complexity rules", () => {
    // A 32-byte base64url token with no symbol and no uppercase is excellent.
    // Rejecting it would push operators toward memorable, guessable values.
    expect(classifySetupToken("k7mqx2vb9plnr4tz8swdf6hj3yc5ae1gn0ut7io2km4").state).toBe(
      "usable",
    )
  })
})

describe("verification", () => {
  it("accepts the exact configured token", () => {
    expect(verifySetupToken(GOOD, GOOD)).toBe(true)
  })

  it("rejects a wrong token", () => {
    expect(verifySetupToken(GOOD, "K7mQx2vB9pLnR4tZ8sWdF6hJ3yC5aE1gN0uT7iO2kM5")).toBe(false)
  })

  it("rejects a prefix of the configured token", () => {
    // The classic length-oracle shape: a comparison that returns early on the
    // first differing byte tells an attacker how much of the prefix was right.
    expect(verifySetupToken(GOOD, GOOD.slice(0, 10))).toBe(false)
  })

  it("rejects the empty string against a configured token", () => {
    expect(verifySetupToken(GOOD, "")).toBe(false)
  })

  it("rejects everything when no token is configured", () => {
    // Fails CLOSED. A missing deployment secret must not mean "any answer
    // works", which is what a naive `configured === supplied` would do for two
    // empty strings.
    expect(verifySetupToken(undefined, "")).toBe(false)
    expect(verifySetupToken(undefined, GOOD)).toBe(false)
    expect(verifySetupToken("", "")).toBe(false)
  })

  it("rejects an unsafe configured token even when the caller quotes it back", () => {
    // Otherwise a deployment with FLOWCMS_SETUP_TOKEN=changeme is defended by
    // nothing at all, while appearing to be defended by a token.
    expect(verifySetupToken("changeme", "changeme")).toBe(false)
  })

  it("compares tokens of wildly different lengths without throwing", () => {
    // `timingSafeEqual` throws on unequal buffer lengths, which is exactly the
    // trap: catching that per-call and returning false reintroduces a length
    // oracle. Hashing both sides first is what makes the lengths always equal.
    expect(() => verifySetupToken(GOOD, "x".repeat(5000))).not.toThrow()
    expect(verifySetupToken(GOOD, "x".repeat(5000))).toBe(false)
  })

  it("is case- and whitespace-exact", () => {
    // A deployment secret is copied, never typed, so normalising it would only
    // widen the accepted set.
    expect(verifySetupToken(GOOD, GOOD.toLowerCase())).toBe(false)
    expect(verifySetupToken(GOOD, ` ${GOOD} `)).toBe(false)
  })
})
