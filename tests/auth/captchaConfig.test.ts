import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it } from "vitest"
import {
  classifyCaptchaConfig,
  isCaptchaConfigured,
  readCaptchaSecret,
} from "@/Framework/Captcha/captchaConfig"

/**
 * `CAPTCHA_SECRET` is REQUIRED for a functional production installation.
 *
 * That sentence is the whole of Phase 7.1.1. The implementation was already
 * fail-closed — an unset secret makes `signCaptcha` throw and
 * `verifyCaptchaToken` refuse everything, so login becomes IMPOSSIBLE rather
 * than unguarded. What was wrong was that `compose.yml` and `docs/docker.md`
 * told operators the opposite ("absent disables the login CAPTCHA"), and
 * nothing detected the misconfiguration until somebody tried to sign in — by
 * which time first-run setup had already completed into an installation nobody
 * could administer.
 *
 * This module is the single authority. The captcha route, readiness, startup
 * validation and the first-run prerequisites all ask it, and none of them
 * restates the rule.
 */

const GOOD = "K7mQx2vB9pLnR4tZ8sWdF6hJ3yC5aE1gN0uT7iO2kM4"
const saved = process.env.CAPTCHA_SECRET

afterEach(() => {
  if (saved === undefined) delete process.env.CAPTCHA_SECRET
  else process.env.CAPTCHA_SECRET = saved
})

describe("the required-production meaning", () => {
  it("calls a missing secret a CONFIGURATION ERROR, not a disabled feature", () => {
    // The correction. There is no "captcha off" state in FlowCMS.
    const verdict = classifyCaptchaConfig(undefined)
    expect(verdict.state).toBe("missing")
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toMatch(/required/i)
    expect(verdict.message).not.toMatch(/disabl/i)
    expect(verdict.message).not.toMatch(/optional/i)
  })

  it("accepts a real secret", () => {
    const verdict = classifyCaptchaConfig(GOOD)
    expect(verdict.state).toBe("usable")
    expect(verdict.ok).toBe(true)
    expect(verdict.message).toBeNull()
  })

  it("refuses an empty string exactly as it refuses an unset variable", () => {
    // Compose writes `CAPTCHA_SECRET: ${CAPTCHA_SECRET:-}`, so "unset" reaches
    // the process as "". The two must not behave differently.
    expect(classifyCaptchaConfig("").state).toBe("missing")
    expect(classifyCaptchaConfig("   ").state).toBe("missing")
  })

  it("refuses a short secret", () => {
    // The secret is an HMAC key. A guessable one lets an attacker mint their
    // own valid challenge, which defeats the CAPTCHA completely — the token is
    // trusted precisely because only the server can sign it.
    expect(classifyCaptchaConfig("short-key").state).toBe("unsafe")
    expect(classifyCaptchaConfig("short-key").ok).toBe(false)
  })

  it("refuses the placeholder .env.example ships", () => {
    expect(classifyCaptchaConfig("replace-me-with-32-random-bytes-base64").state).toBe("unsafe")
  })

  it("explains what breaks, so the operator knows why it matters", () => {
    for (const value of [undefined, "short-key"]) {
      const verdict = classifyCaptchaConfig(value)
      expect(verdict.message).toMatch(/CAPTCHA_SECRET/)
      expect(verdict.message).toMatch(/sign in|log in|login/i)
    }
  })

  it("tells the operator how to generate one", () => {
    expect(classifyCaptchaConfig(undefined).message).toMatch(/randomBytes/)
  })
})

describe("it never reproduces the secret", () => {
  it("keeps the value out of every message", () => {
    const secretish = "abababababababababababababababab"
    const verdict = classifyCaptchaConfig(secretish)
    expect(verdict.state).toBe("unsafe")
    expect(JSON.stringify(verdict)).not.toContain(secretish)
  })

  it("never reports a prefix, a hash or the value's length", () => {
    const verdict = classifyCaptchaConfig("xyz")
    const serialized = JSON.stringify(verdict)
    expect(serialized).not.toContain("xyz")
    // The RULE's number may appear; a measurement of the value may not.
    expect(serialized).not.toMatch(/\b3 characters\b/)
  })

  it("carries a bounded, fixed shape", () => {
    expect(Object.keys(classifyCaptchaConfig(GOOD)).sort()).toEqual(["message", "ok", "state"])
  })
})

describe("reading the environment", () => {
  it("reads CAPTCHA_SECRET at call time, not at module load", () => {
    // Read per call so a test — and an operator restarting with a corrected
    // value — sees the change, and so the secret never sits in module state.
    process.env.CAPTCHA_SECRET = GOOD
    expect(readCaptchaSecret()).toBe(GOOD)
    delete process.env.CAPTCHA_SECRET
    expect(readCaptchaSecret()).toBeUndefined()
  })

  it("isCaptchaConfigured answers for the live environment", () => {
    process.env.CAPTCHA_SECRET = GOOD
    expect(isCaptchaConfigured()).toBe(true)

    delete process.env.CAPTCHA_SECRET
    expect(isCaptchaConfigured()).toBe(false)

    process.env.CAPTCHA_SECRET = "changeme"
    expect(isCaptchaConfigured()).toBe(false)
  })
})

/**
 * The correction must never become a bypass.
 *
 * The tempting "fix" for "an unset secret breaks login" is
 * `if (!process.env.CAPTCHA_SECRET) skipCaptcha()`. That would turn a
 * misconfigured deployment — the one most likely to be an unattended default
 * install on the open internet — into one with no login CAPTCHA at all, while
 * looking healthier than before. Phase 7.1.1 makes the misconfiguration VISIBLE;
 * it does not make it survivable.
 */
describe("no bypass was introduced", () => {
  const read = (path: string) => readFileSync(path, "utf8")

  /** Source with comments stripped, so prose about bypasses cannot trip a guard. */
  function code(source: string): string {
    const BLOCK = new RegExp("/\\*[\\s\\S]*?\\*/", "g")
    const LINE = new RegExp("(^|[^:])//.*$", "gm")
    return source.replace(BLOCK, "").replace(LINE, "$1")
  }

  it("authorize() still consumes a captcha unconditionally", () => {
    const auth = code(read("src/Framework/Auth/auth.ts"))
    expect(auth).toMatch(/consumeCaptcha\(/)
    // No branch anywhere in the sign-in path that reads the secret directly.
    expect(auth).not.toMatch(/CAPTCHA_SECRET/)
    expect(auth).not.toMatch(/isCaptchaConfigured|getCaptchaConfig/)
  })

  it("the captcha module has no escape hatch", () => {
    const captcha = code(read("src/Framework/Captcha/captcha.ts"))
    // `verifyCaptchaToken` must keep returning false — not true — when signing
    // is impossible. The `catch` around `sign()` is the load-bearing line.
    expect(captcha).toMatch(/catch\s*\{\s*return false/)
    expect(captcha).not.toMatch(/return true/)
  })

  it("nothing in the codebase treats an absent secret as permission", () => {
    for (const file of [
      "src/Framework/Auth/auth.ts",
      "src/Framework/Captcha/captcha.ts",
      "src/Framework/Captcha/captchaConfig.ts",
      "src/app/api/captcha/route.ts",
    ]) {
      const source = code(read(file))
      // The shape of the bug: a negated secret check that opens something.
      expect(source, file).not.toMatch(/if\s*\(\s*!\s*(process\.env\.CAPTCHA_SECRET|secret)\s*\)[^\n]*(true|skip|bypass|allow)/i)
    }
  })

  it("keeps the verifier fail-closed even for a deployment with no secret", async () => {
    const { signCaptcha, verifyCaptchaToken } = await import("@/Framework/Captcha/captcha")
    process.env.CAPTCHA_SECRET = GOOD
    const token = signCaptcha("AB2CD")

    delete process.env.CAPTCHA_SECRET
    // The correct answer, the correct token, and no secret: still refused.
    expect(verifyCaptchaToken(token, "AB2CD")).toBe(false)
    // And an empty answer against an empty token is not accidentally "equal".
    expect(verifyCaptchaToken(undefined, "")).toBe(false)
    expect(verifyCaptchaToken("", "")).toBe(false)
  })
})
