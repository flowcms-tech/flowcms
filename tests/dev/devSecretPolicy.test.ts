import { describe, expect, it } from "vitest"
import { classifyDeploymentSecret } from "@/Framework/Config/deploymentSecret"
import {
  MANAGED_VARIABLES,
  classifyLocalSecret,
  ensureLocalEnvironment,
  generateAcceptable,
  parseEnvText,
} from "../../scripts/dev/localEnv.mjs"

/**
 * THE LOCAL DEV ENVIRONMENT MAY NOT BE A HOLE IN THE SECRET POLICY.
 *
 * `scripts/dev/localEnv.mjs` restates `Framework/Config/deploymentSecret.ts`
 * because it is plain ESM running before anything is built and cannot import a
 * TypeScript module behind the `@/` alias — the same constraint
 * `scripts/migrate.mjs` has, answered the same way `tests/config/migrateParity`
 * answers it. This file is the pin: the same inputs go through both, and any
 * disagreement fails here rather than becoming a development environment that
 * accepts a secret production would refuse.
 *
 * The direction of authority is fixed. If these two disagree, the application
 * is right and the script is wrong.
 */

const shaped = (value: string) => ({
  local: classifyLocalSecret(value),
  application: classifyDeploymentSecret(value),
})

/**
 * Inputs chosen to hit every branch on both sides, including the ones a
 * development shortcut would be tempted to wave through.
 */
const CASES: Array<[label: string, value: string]> = [
  ["empty", ""],
  ["whitespace only", "   "],
  ["one character", "x"],
  ["23 characters, one short", "a1b2c3d4e5f6g7h8i9j0k1l"],
  ["24 characters, exactly the floor", "a1b2c3d4e5f6g7h8i9j0k1l2"],
  ["long but only two distinct characters", "abababababababababababababababab"],
  ["long but seven distinct characters", "abcdefgabcdefgabcdefgabcdefg"],
  ["the .env.example placeholder", "replace-me-with-32-random-bytes-base64"],
  ["a documentation-shaped value", "changeme-changeme-changeme-changeme"],
  ["contains 'example'", "aaaaBBBBccccDDDD-example-1234567"],
  ["contains 'default'", "Zk3-default-Qp9wLm2xTv6yRb8nHc4d"],
  ["contains 'password'", "Zk3-password-Qp9wLm2xTv6yRb8nHc4"],
  ["delimited todo", "todo-Qp9wLm2xTv6yRb8nHc4dZk3Jf7"],
  ["undelimited todo inside a random value", "Qp9wLmtodo2xTv6yRb8nHc4dZk3Jf7"],
  ["a real base64url secret", "hVJ7q2Nm4xZpKt8Ls3Rd9Yb6Wc1Ff0Ge5Aa2Uu7Ii"],
  ["leading and trailing whitespace around a good value", "  hVJ7q2Nm4xZpKt8Ls3Rd9Yb6Wc  "],
]

describe("the dev script and the application classify secrets identically", () => {
  it.each(CASES)("%s", (_label, value) => {
    const { local, application } = shaped(value)
    expect(local.state).toBe(application.state)
    expect(local.reason).toBe(application.reason)
  })

  it("covers every state, so the table cannot silently test one branch", () => {
    const states = new Set(CASES.map(([, value]) => classifyDeploymentSecret(value).state))
    expect([...states].sort()).toEqual(["missing", "unsafe", "usable"])
  })
})

describe("generated development secrets satisfy the real production rules", () => {
  // The generator retries until the application would accept the value, which
  // is what makes this assertion safe to state at 500 samples rather than
  // "usually". A random string CAN contain a placeholder marker — see the
  // `todo` incident recorded in deploymentSecret.ts — and a dev environment
  // born with an unusable secret is a confusing morning.
  const secretVariables = MANAGED_VARIABLES.filter((variable) => variable.deploymentSecret)

  it("has secret-classified variables to check", () => {
    expect(secretVariables.map((variable) => variable.key)).toEqual([
      "AUTH_SECRET",
      "CAPTCHA_SECRET",
      "FLOWCMS_SETUP_TOKEN",
      "PREVIEW_SECRET",
    ])
  })

  it.each(secretVariables.map((v) => [v.key, v] as const))(
    "%s generates 500 values the application accepts",
    (_key, variable) => {
      for (let i = 0; i < 500; i++) {
        const value = generateAcceptable(variable.generate)
        expect(classifyDeploymentSecret(value).state).toBe("usable")
      }
    },
  )

  it("generateAcceptable throws rather than looping forever on an impossible policy", () => {
    expect(() => generateAcceptable(() => "changeme", 5)).toThrow(/attempts/)
  })

  it("never generates a value from a non-cryptographic source", () => {
    // Two draws being equal would mean a constant, a counter or a seeded PRNG.
    const first = generateAcceptable(secretVariables[0].generate)
    const second = generateAcceptable(secretVariables[0].generate)
    expect(first).not.toEqual(second)
    expect(first.length).toBeGreaterThanOrEqual(32)
  })
})

describe("the env file parser", () => {
  it("reads plain, exported and quoted assignments", () => {
    const parsed = parseEnvText(
      ["# a comment", "", "A=1", "export B=2", 'C="three"', "D='four'", "malformed"].join("\n"),
    )
    expect(parsed).toEqual({ A: "1", B: "2", C: "three", D: "four" })
  })

  it("does not expand anything inside a value", () => {
    // A credential containing `$` is a literal, not a reference. Expanding one
    // corrupts the secret in a way that only shows up as a failed login.
    expect(parseEnvText("A=$B/c+d=")).toEqual({ A: "$B/c+d=" })
  })
})

describe("resolution is idempotent and never fights a configured value", () => {
  const configured = "hVJ7q2Nm4xZpKt8Ls3Rd9Yb6Wc1Ff0Ge5Aa2Uu7Ii"

  /**
   * Resolution against nothing on disk and nothing persisted.
   *
   * `persist: false` and the two absent paths keep the suite from reading a
   * developer's real `.env` or writing into the repository root — the values
   * under test are the ones passed in, on every machine.
   */
  interface Resolution {
    values: Record<string, string>
    sources: Record<string, string>
    generated: string[]
  }

  // `localEnv.mjs` is plain ESM with no declarations, so its return shape
  // arrives as `{}` and its `shellEnv` parameter as Node's `ProcessEnv`. The
  // annotation here is the test's own contract with that module — the parity
  // assertions above are what actually police its behaviour.
  const resolve = (shellEnv: Record<string, string>): Resolution =>
    (
      ensureLocalEnvironment as (options: {
        shellEnv: Record<string, string>
        envPath: string
        localPath: string
        persist: boolean
      }) => Resolution
    )({
      shellEnv,
      envPath: "/nonexistent/.env",
      localPath: "/nonexistent/.env.dev.local",
      persist: false,
    })

  it("returns a shell-provided value unchanged and does not generate one", () => {
    const result = resolve(Object.fromEntries(MANAGED_VARIABLES.map((v) => [v.key, configured])))

    expect(result.generated).toEqual([])
    for (const variable of MANAGED_VARIABLES) {
      expect(result.values[variable.key]).toBe(configured)
      expect(result.sources[variable.key]).toBe("shell")
    }
  })

  it("generates every managed variable when nothing supplies one", () => {
    const result = resolve({})
    expect(result.generated.sort()).toEqual(MANAGED_VARIABLES.map((v) => v.key).sort())
  })

  it("treats an empty value as unconfigured rather than as a configured empty string", () => {
    // This is the exact shape that locked the setup page: `compose.yml` passes
    // `FLOWCMS_SETUP_TOKEN: ${FLOWCMS_SETUP_TOKEN:-}`, so an absent variable
    // arrives as a SET, EMPTY one — and a resolver that checked only for
    // presence would faithfully propagate nothing at all.
    const result = resolve(Object.fromEntries(MANAGED_VARIABLES.map((v) => [v.key, "  "])))
    expect(result.sources.FLOWCMS_SETUP_TOKEN).toBe("generated")
    expect(classifyDeploymentSecret(result.values.FLOWCMS_SETUP_TOKEN).state).toBe("usable")
  })

  it("resolving twice with the same inputs returns the same values", () => {
    // Idempotence is what lets `dev:reset` keep a developer's setup token
    // valid: nothing rotates because a start happened.
    const shellEnv = Object.fromEntries(MANAGED_VARIABLES.map((v) => [v.key, configured]))
    expect(resolve(shellEnv).values).toEqual(resolve(shellEnv).values)
  })
})
