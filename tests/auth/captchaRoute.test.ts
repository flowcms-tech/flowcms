import { afterEach, describe, expect, it } from "vitest"
import { GET } from "@/app/api/captcha/route"

/**
 * `/api/captcha` must never answer a configuration problem with an opaque 500.
 *
 * Before Phase 7.1.1 it did: `signCaptcha()` threw `CAPTCHA_SECRET is not set`,
 * the throw escaped the handler, and the operator got a stack-free 500 on the
 * login page with nothing to act on. The CAPTCHA was not weakened by that — it
 * was unreachable, which made the admin panel unreachable — but "the endpoint
 * errors" is a much worse diagnostic than "the endpoint says what is wrong".
 *
 * These cases exercise the guard, which returns before any canvas is drawn and
 * before any cookie is set, so they need no request context.
 */

const GOOD = "K7mQx2vB9pLnR4tZ8sWdF6hJ3yC5aE1gN0uT7iO2kM4"
const saved = process.env.CAPTCHA_SECRET

afterEach(() => {
  if (saved === undefined) delete process.env.CAPTCHA_SECRET
  else process.env.CAPTCHA_SECRET = saved
})

describe("with an invalid deployment configuration", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["too short", "short-key"],
    ["a documentation placeholder", "replace-me-with-32-random-bytes-base64"],
  ])("answers 503 rather than throwing, when the secret is %s", async (_label, value) => {
    if (value === undefined) delete process.env.CAPTCHA_SECRET
    else process.env.CAPTCHA_SECRET = value

    const response = await GET()

    // 503, not 500: this is a deployment that is not configured to serve, and
    // it will be after a restart with the variable set. Not 200 with a blank
    // image either — an unanswerable challenge is worse than a clear refusal.
    expect(response.status).toBe(503)
    expect(response.headers.get("Content-Type")).toMatch(/application\/json/)
  })

  it("issues no captcha cookie when it refuses", async () => {
    delete process.env.CAPTCHA_SECRET
    const response = await GET()
    expect(response.headers.get("set-cookie")).toBeNull()
  })

  it("says a configuration is at fault without naming the value", async () => {
    process.env.CAPTCHA_SECRET = "short-key"
    const response = await GET()
    const raw = await response.text()

    expect(raw).toMatch(/configur/i)
    // The secret, however short, must not come back.
    expect(raw).not.toContain("short-key")
    // Nor a stack trace, nor the raw thrown message from signCaptcha().
    expect(raw).not.toMatch(/at .*\.ts:\d+/)
    expect(raw).not.toContain("CAPTCHA_SECRET is not set")
  })

  it("does not tell an anonymous caller which rule was broken", async () => {
    // The login page is public. "Your secret is too short" is a fact about the
    // deployment that only the operator needs, and it belongs in the server
    // log, where this module also writes it.
    process.env.CAPTCHA_SECRET = "short-key"
    const raw = await (await GET()).text()
    expect(raw).not.toMatch(/at least \d+ characters/i)
    expect(raw).not.toMatch(/placeholder/i)
    expect(raw).not.toMatch(/randomBytes/)
  })

  it("never sends a cacheable response", async () => {
    // A cached 503 would outlive the restart that fixes it.
    delete process.env.CAPTCHA_SECRET
    expect((await GET()).headers.get("Cache-Control")).toMatch(/no-store/)
  })
})

describe("with a valid secret", () => {
  it("does not refuse on configuration grounds", async () => {
    // The guard must not fire for a well-configured deployment. Actually
    // rendering the PNG needs a request context for `cookies()`, which this
    // environment has no way to provide — so the assertion is narrow and
    // honest: whatever happens next, it is not the 503 above.
    process.env.CAPTCHA_SECRET = GOOD
    let status: number | null = null
    try {
      status = (await GET()).status
    } catch {
      // Reaching the cookie store outside a request is the expected outcome
      // here, and it proves the guard let the request through.
      status = null
    }
    expect(status).not.toBe(503)
  })
})
