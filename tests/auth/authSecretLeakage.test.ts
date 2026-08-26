import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildReadinessReport } from "@/Framework/Health/readiness"
import { buildPrerequisites } from "@/Framework/Setup/prerequisites"
import {
  classifyAuthSecret,
  logAuthSecretProblem,
  resolveAuthSecret,
} from "@/Framework/Auth/authSecretConfig"

/**
 * `AUTH_SECRET` must never appear anywhere a person or a log aggregator can
 * read it.
 *
 * It is the highest-value secret in the product: whoever holds it can mint a
 * session for any account without touching a password, a CAPTCHA or the rate
 * limiter. A value that leaks into a JSON response, an HTML page, a console
 * line or a serialized error is compromised for as long as it stays set — and
 * rotating it signs every legitimate user out, so the leak is expensive as well
 * as dangerous.
 */

/** A value distinctive enough that finding it anywhere is unambiguous. */
const SECRET = "UNIQUE-AUTH-SECRET-CANARY-9f3b7c1e5a2d8046"
const saved = process.env.AUTH_SECRET

afterEach(() => {
  vi.restoreAllMocks()
  if (saved === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = saved
})

describe("the value never reaches a response body", () => {
  it("is absent from the readiness report", () => {
    process.env.AUTH_SECRET = SECRET
    const report = buildReadinessReport({
      database: "ok",
      storage: "connected",
      auth: classifyAuthSecret(process.env.AUTH_SECRET).state,
    })
    expect(JSON.stringify(report)).not.toContain(SECRET)
    expect(report.auth).toBe("usable")
  })

  it("is absent from the readiness report when it is the REJECTED value", () => {
    // The dangerous direction: a rejected secret is the one a diagnostic is
    // most tempted to quote.
    process.env.AUTH_SECRET = "replace-me-with-32-random-bytes-base64"
    const report = buildReadinessReport({
      database: "ok",
      storage: "connected",
      auth: classifyAuthSecret(process.env.AUTH_SECRET).state,
    })
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain("replace-me")
    expect(report.auth).toBe("unsafe")
  })

  it("is absent from the setup prerequisites", () => {
    process.env.AUTH_SECRET = SECRET
    const gate = buildPrerequisites({ database: "ready", storage: "ready", captcha: "ready", auth: "ready" })
    expect(JSON.stringify(gate)).not.toContain(SECRET)
  })

  it("is absent from every verdict the validator produces", () => {
    for (const value of [SECRET, "replace-me-with-32-random-bytes-base64", "short", "", undefined]) {
      const verdict = classifyAuthSecret(value)
      const serialized = JSON.stringify(verdict)
      if (value) expect(serialized, String(value)).not.toContain(value)
    }
  })
})

describe("the value never reaches the console", () => {
  it("is absent from the operator diagnostic, for every rejected shape", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})

    for (const value of ["replace-me-with-32-random-bytes-base64", "short", "changeme", ""]) {
      process.env.AUTH_SECRET = value
      logAuthSecretProblem("test", classifyAuthSecret(process.env.AUTH_SECRET))
    }

    expect(error).toHaveBeenCalled()
    const written = error.mock.calls.map((call) => call.join(" ")).join("\n")
    for (const value of ["replace-me-with-32-random-bytes-base64", "changeme"]) {
      expect(written).not.toContain(value)
    }
    // It names the variable and the fix, which is the point of logging at all.
    expect(written).toMatch(/AUTH_SECRET/)
    expect(written).toMatch(/randomBytes/)
  })

  it("logs nothing at all when the secret is fine", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    process.env.AUTH_SECRET = SECRET
    logAuthSecretProblem("test", classifyAuthSecret(process.env.AUTH_SECRET))
    expect(error).not.toHaveBeenCalled()
  })

  it("does not report the value's length as a measurement", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    process.env.AUTH_SECRET = "abc"
    logAuthSecretProblem("test", classifyAuthSecret(process.env.AUTH_SECRET))
    const written = error.mock.calls.map((call) => call.join(" ")).join("\n")
    expect(written).not.toMatch(/\b3\b/)
  })
})

describe("the value never reaches a thrown error", () => {
  it("survives serialization of a verdict without appearing", () => {
    process.env.AUTH_SECRET = SECRET
    const verdict = classifyAuthSecret(process.env.AUTH_SECRET)
    // The shapes an error handler is most likely to stringify.
    expect(JSON.stringify(verdict)).not.toContain(SECRET)
    expect(String(verdict.message)).not.toContain(SECRET)
    expect(Object.values(verdict).join(" ")).not.toContain(SECRET)
  })

  it("is not carried on the Error a caller might throw and log", () => {
    process.env.AUTH_SECRET = "replace-me-with-32-random-bytes-base64"
    const verdict = classifyAuthSecret(process.env.AUTH_SECRET)
    const error = new Error(verdict.message ?? "")
    expect(error.message).not.toContain("replace-me")
    expect(error.stack ?? "").not.toContain("replace-me")
  })
})

describe("the value never reaches rendered HTML", () => {
  const SETUP_UI = join(process.cwd(), "src/Modules/Setup")

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry)
      return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(full) ? [full] : []
    })
  }

  it("is never read by any client component", () => {
    // The setup page renders a STATE. A component that read the variable would
    // be serializing a deployment secret into the HTML payload.
    const files = walk(SETUP_UI)
    expect(files.length).toBeGreaterThan(2)
    for (const file of files) {
      const source = readFileSync(file, "utf8")
      const rel = relative(process.cwd(), file).split(sep).join("/")
      // NAMING the variable in help text is correct and necessary — the
      // operator has to know which one to set. READING it is the leak.
      expect(source, rel).not.toMatch(/process\.env\.AUTH_SECRET/)
      expect(source, rel).not.toMatch(/resolveAuthSecret|readCaptchaSecret|getAuthSecretConfig/)
    }
  })

  it("is never asked for on the setup form", () => {
    // §8: it stays deployment configuration. The form must not offer a field.
    const validations = readFileSync("src/Modules/Setup/Values/Validations.ts", "utf8")
    expect(validations).not.toMatch(/authSecret|AUTH_SECRET/i)
  })
})

describe("what Auth.js receives never becomes a leak either", () => {
  it("returns nothing rather than a redacted-looking placeholder", () => {
    // A sentinel like "***" or "invalid" would be a value Auth.js could sign
    // with, and every deployment missing a secret would share it — so the
    // withheld branch must yield NO value at all.
    //
    // This suite's process has no usable AUTH_SECRET, so that is the branch
    // under test here. The valid branch is covered in authSecretConfig.test.ts
    // and end to end in the Docker proof.
    const resolved = resolveAuthSecret()
    expect(resolved).toBeUndefined()
    expect(String(resolved)).not.toMatch(/redact|placeholder|\*/i)
  })
})
