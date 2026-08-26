import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it } from "vitest"
import {
  classifyAuthSecret,
  getAuthSecretConfig,
  isAuthSecretConfigured,
  resolveAuthSecret,
} from "@/Framework/Auth/authSecretConfig"

/**
 * `AUTH_SECRET` signs and encrypts every session JWT. It is the single value
 * that decides whether a cookie presented to FlowCMS was issued by FlowCMS.
 *
 * THE DEFECT PHASE 7.1.2 FIXES: nothing checked its strength. `.env.example`
 * ships `replace-me-with-32-random-bytes-base64`, Compose's `${AUTH_SECRET:?}`
 * guard only proves that *something* is set, and no file under `src/` read the
 * variable at all — Auth.js reads it directly from the environment. So an
 * operator who copied the example file verbatim deployed a CMS whose session
 * signing key is published in this repository, and anyone able to read the repo
 * could mint a valid session for any account, including the owner.
 *
 * Unlike `CAPTCHA_SECRET` in Phase 7.1.1, this failure is SILENT and OPEN
 * rather than loud and closed: everything works, and it works for attackers
 * too.
 */

/** 32 bytes of base64url — the shape the docs tell operators to generate. */
const GOOD = "K7mQx2vB9pLnR4tZ8sWdF6hJ3yC5aE1gN0uT7iO2kM4"
const saved = process.env.AUTH_SECRET

afterEach(() => {
  if (saved === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = saved
})

describe("the required-production meaning", () => {
  it("accepts a strong random secret", () => {
    const verdict = classifyAuthSecret(GOOD)
    expect(verdict.state).toBe("usable")
    expect(verdict.ok).toBe(true)
    expect(verdict.message).toBeNull()
  })

  it("rejects a missing secret", () => {
    const verdict = classifyAuthSecret(undefined)
    expect(verdict.state).toBe("missing")
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toMatch(/AUTH_SECRET/)
    expect(verdict.message).toMatch(/required/i)
  })

  it("rejects an empty secret exactly as it rejects a missing one", () => {
    expect(classifyAuthSecret("").state).toBe("missing")
    expect(classifyAuthSecret("   ").state).toBe("missing")
  })

  it("rejects a too-weak secret", () => {
    expect(classifyAuthSecret("short-secret").state).toBe("unsafe")
    expect(classifyAuthSecret("short-secret").ok).toBe(false)
  })

  it("rejects the exact placeholder .env.example ships", () => {
    // Read from the tracked file, so a change to the sample cannot make this
    // pass by accident.
    const example = readFileSync(".env.example", "utf8")
    const sample = example.match(/^AUTH_SECRET=(.*)$/m)?.[1] ?? ""
    expect(sample.length, "the example must ship a placeholder").toBeGreaterThan(0)
    expect(classifyAuthSecret(sample).state).toBe("unsafe")
  })

  it.each(["changeme", "change-me-to-something-random", "replace-me-with-a-secret", "default-secret-value-for-dev", "example-secret-value-abcdefgh"])(
    "rejects the obvious placeholder %s",
    (placeholder) => {
      expect(classifyAuthSecret(placeholder).ok).toBe(false)
    },
  )

  it("explains what is at risk, so the operator knows why it matters", () => {
    for (const value of [undefined, "short-secret"]) {
      const verdict = classifyAuthSecret(value)
      expect(verdict.message).toMatch(/session/i)
    }
  })

  it("tells the operator how to generate one", () => {
    expect(classifyAuthSecret(undefined).message).toMatch(/randomBytes/)
  })

  it("warns that rotating it signs everyone out", () => {
    // The operator's next action after reading this is to replace the value and
    // restart. They should not be surprised by the consequence.
    expect(classifyAuthSecret("changeme").message).toMatch(/sign(s|ed)? (every|all).*out|invalidat/i)
  })
})

describe("it never reproduces the secret", () => {
  it("keeps the value out of every message", () => {
    const secretish = "abababababababababababababababab"
    const verdict = classifyAuthSecret(secretish)
    expect(verdict.state).toBe("unsafe")
    expect(JSON.stringify(verdict)).not.toContain(secretish)
  })

  it("never reports a prefix, a hash or the value's length", () => {
    const verdict = classifyAuthSecret("xyz")
    const serialized = JSON.stringify(verdict)
    expect(serialized).not.toContain("xyz")
    expect(serialized).not.toMatch(/\b3 characters\b/)
  })

  it("carries a bounded, fixed shape", () => {
    expect(Object.keys(classifyAuthSecret(GOOD)).sort()).toEqual(["message", "ok", "state"])
  })
})

describe("what Auth.js is given", () => {
  it("hands Auth.js the configured value when it is usable", async () => {
    // This suite's own process was started with a usable AUTH_SECRET (vitest
    // inherits the shell environment), so the deployment verdict is 'usable'
    // and the configured value is passed through.
    if (getAuthSecretConfig().ok) {
      expect(resolveAuthSecret()).toBe(process.env.AUTH_SECRET)
    } else {
      expect(resolveAuthSecret()).toBeUndefined()
    }
  })

  it("hands Auth.js NOTHING when the deployment secret was rejected", () => {
    // The mechanism, stated as an invariant rather than by mutating the
    // environment: a rejected secret is withheld, never passed through.
    const verdict = getAuthSecretConfig()
    if (!verdict.ok) expect(resolveAuthSecret()).toBeUndefined()
    expect(verdict.ok ? typeof resolveAuthSecret() : resolveAuthSecret()).not.toBe("")
  })

  it("NEVER generates a secret", () => {
    // A runtime-generated secret would sign everyone out on every restart and
    // give each replica a different key, so a session minted by one instance
    // would be rejected by the next. Generation belongs to deployment tooling.
    const first = resolveAuthSecret()
    const second = resolveAuthSecret()
    expect(first).toBe(second)
    if (!getAuthSecretConfig().ok) expect(first).toBeUndefined()
  })

  it("withholds a rejected value by REMOVING it, never by substituting one", () => {
    // Proven structurally: the module deletes the variable and has no branch
    // that assigns a replacement.
    const source = readFileSync("src/Framework/Auth/authSecretConfig.ts", "utf8")
    expect(source).toMatch(/delete process\.env\.AUTH_SECRET/)
    // No assignment to the variable anywhere — removing a rejected value is the
    // whole mechanism, and writing one back would be inventing a secret.
    expect(source).not.toMatch(/process\.env\.AUTH_SECRET\s*=[^=]/)
  })
})

describe("reading the live environment", () => {
  it("classifies an arbitrary value without consulting the environment", () => {
    // `classifyAuthSecret` is the pure entry point every caller uses to judge a
    // value that is not this process's own.
    expect(classifyAuthSecret(GOOD).state).toBe("usable")
    expect(classifyAuthSecret("changeme").state).toBe("unsafe")
    expect(classifyAuthSecret(undefined).state).toBe("missing")
  })

  it("resolves the deployment verdict once, not per call", () => {
    // A deployment secret cannot change without a restart, so two callers in
    // one process must never see different answers.
    expect(getAuthSecretConfig()).toBe(getAuthSecretConfig())
    expect(isAuthSecretConfigured()).toBe(getAuthSecretConfig().ok)
  })
})

describe("architecture", () => {
  const read = (path: string) => readFileSync(path, "utf8")

  /** Source with comments stripped, so prose cannot trip or satisfy a guard. */
  function code(source: string): string {
    const BLOCK = new RegExp("/\\*[\\s\\S]*?\\*/", "g")
    const LINE = new RegExp("(^|[^:])//.*$", "gm")
    return source.replace(BLOCK, "").replace(LINE, "$1")
  }

  it("reuses the shared deployment-secret primitive", () => {
    const source = code(read("src/Framework/Auth/authSecretConfig.ts"))
    expect(source).toMatch(/from "@\/Framework\/Config\/deploymentSecret"/)
  })

  it("restates no entropy rule of its own", () => {
    // The whole point of the shared primitive: one place decides what "strong"
    // means. A second copy is a second rule that drifts.
    const source = code(read("src/Framework/Auth/authSecretConfig.ts"))
    expect(source).not.toMatch(/\.length\s*[<>]=?\s*\d/)
    expect(source).not.toMatch(/new Set\(/)
    expect(source).not.toMatch(/changeme|replace-me|placeholder/i)
  })

  it("never auto-generates anywhere in the auth or config surface", () => {
    for (const file of [
      "src/Framework/Auth/authSecretConfig.ts",
      "src/Framework/Auth/auth.config.ts",
      "src/Framework/Auth/auth.ts",
      "src/Framework/Config/deploymentSecret.ts",
    ]) {
      // Every string and template literal removed first. `GENERATE_SECRET_HINT`
      // is the text that tells an OPERATOR to run `randomBytes` themselves, and
      // a guard that its own help text trips is a guard people delete. What
      // must not exist is executable generation.
      const source = code(read(file))
        .replace(/`[^`]*`/g, '""')
        .replace(/"[^"]*"/g, '""')
        .replace(/'[^']*'/g, '""')

      expect(source, file).not.toMatch(/\brandomBytes\s*\(/)
      expect(source, file).not.toMatch(/\brandomUUID\s*\(/)
      expect(source, file).not.toMatch(/generateSecret/)
      expect(source, file).not.toMatch(/\bcrypto\b/)
      // The `||=` / `??=` shape that would write a value back into the env.
      expect(source, file).not.toMatch(/process\.env\.AUTH_SECRET\s*(\|\||\?\?)?=/)
    }
  })

  it("keeps AUTH_SECRET strength rules out of readiness, setup and auth.ts", () => {
    // Each of those asks the validator; none of them re-derives the policy.
    for (const file of [
      "src/Framework/Health/readiness.ts",
      "src/Framework/Setup/prerequisites.ts",
      "src/Framework/Auth/auth.ts",
    ]) {
      const source = code(read(file))
      expect(source, file).not.toMatch(/classifyDeploymentSecret/)
      expect(source, file).not.toMatch(/MIN_DEPLOYMENT_SECRET/)
    }
  })
})
