import { beforeEach, describe, expect, it } from "vitest"

process.env.CAPTCHA_SECRET = "test-captcha-secret-not-a-real-one"

const {
  consumeCaptcha,
  generateCaptchaCode,
  signCaptcha,
  verifyCaptchaToken,
} = await import("@/Framework/Captcha/captcha")
const { __resetInMemoryRateLimitStore } = await import("@/Framework/RateLimit/RateLimiter")

describe("captcha token", () => {
  it("verifies a freshly signed code, case-insensitively", () => {
    const token = signCaptcha("AB2CD")
    expect(verifyCaptchaToken(token, "AB2CD")).toBe(true)
    expect(verifyCaptchaToken(token, "ab2cd")).toBe(true)
  })

  it("rejects the wrong answer", () => {
    expect(verifyCaptchaToken(signCaptcha("AB2CD"), "XY9ZW")).toBe(false)
  })

  it("rejects a tampered signature", () => {
    const token = signCaptcha("AB2CD")
    const parts = token.split(".")
    parts[parts.length - 1] = "0".repeat(parts[parts.length - 1].length)
    expect(verifyCaptchaToken(parts.join("."), "AB2CD")).toBe(false)
  })

  it("rejects a token whose code was swapped while keeping the signature", () => {
    // The classic forgery: take a valid signature and point it at a code you
    // know the answer to.
    const token = signCaptcha("AB2CD")
    const parts = token.split(".")
    parts[0] = "ZZ9ZZ"
    expect(verifyCaptchaToken(parts.join("."), "ZZ9ZZ")).toBe(false)
  })

  it("binds the expiry into the signature so it cannot be extended", () => {
    const token = signCaptcha("AB2CD")
    const parts = token.split(".")
    expect(parts.length).toBe(3)
    // Push the expiry a year out; the signature no longer covers it.
    parts[1] = String(Date.now() + 365 * 24 * 3600 * 1000)
    expect(verifyCaptchaToken(parts.join("."), "AB2CD")).toBe(false)
  })

  it("rejects an expired token even though its signature is valid", () => {
    const past = Date.now() - 1000
    const token = signCaptcha("AB2CD", past)
    expect(verifyCaptchaToken(token, "AB2CD")).toBe(false)
  })

  it("rejects malformed and missing input without throwing", () => {
    expect(verifyCaptchaToken(undefined, "AB2CD")).toBe(false)
    expect(verifyCaptchaToken("", "AB2CD")).toBe(false)
    expect(verifyCaptchaToken("nonsense", "AB2CD")).toBe(false)
    expect(verifyCaptchaToken("a.b", "AB2CD")).toBe(false)
    expect(verifyCaptchaToken(signCaptcha("AB2CD"), "")).toBe(false)
  })

  it("generates codes from an unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateCaptchaCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/)
    }
  })
})

describe("consumeCaptcha — single use", () => {
  beforeEach(() => {
    __resetInMemoryRateLimitStore()
  })

  it("accepts a correct answer once", async () => {
    const token = signCaptcha("AB2CD")
    expect(await consumeCaptcha(token, "AB2CD")).toBe(true)
  })

  it("rejects a replay of the same token, which is the bypass this closes", async () => {
    // Cookie deletion alone cannot enforce single use: an attacker posting
    // directly to the credentials endpoint controls their own cookie jar and
    // can simply keep sending the same value.
    const token = signCaptcha("AB2CD")
    expect(await consumeCaptcha(token, "AB2CD")).toBe(true)
    expect(await consumeCaptcha(token, "AB2CD")).toBe(false)
    expect(await consumeCaptcha(token, "AB2CD")).toBe(false)
  })

  it("does not consume the token when the answer is wrong", async () => {
    // A typo must not burn the challenge — otherwise every mistyped code forces
    // a page refresh, and users learn to hate the login screen.
    const token = signCaptcha("AB2CD")
    expect(await consumeCaptcha(token, "WRONG")).toBe(false)
    expect(await consumeCaptcha(token, "AB2CD")).toBe(true)
  })

  it("treats a missing token as a failure", async () => {
    expect(await consumeCaptcha(undefined, "AB2CD")).toBe(false)
  })
})

describe("fail-closed when CAPTCHA_SECRET is unset", () => {
  it("verifies nothing rather than throwing past the caller", async () => {
    const saved = process.env.CAPTCHA_SECRET
    const token = signCaptcha("AB2CD")
    delete process.env.CAPTCHA_SECRET
    try {
      expect(verifyCaptchaToken(token, "AB2CD")).toBe(false)
    } finally {
      process.env.CAPTCHA_SECRET = saved
    }
  })
})
