import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, sep } from "node:path"
import { generateDeploymentSecret } from "../../packages/create-flowcms/src/secrets.mjs"
import { classifyDeploymentSecret } from "@/Framework/Config/deploymentSecret"
import { classifyAuthSecret } from "@/Framework/Auth/authSecretConfig"

/**
 * THE GENERATOR AND THE VALIDATOR HAVE TO AGREE, and they live in different
 * packages on purpose.
 *
 * `create-flowcms` is a standalone package: it cannot import `@/Framework/…`,
 * because a published CLI has no access to the application's source tree. The
 * obvious workaround — restating the entropy rules inside the CLI — is the one
 * thing that must not happen. Two copies of a policy drift, and the drift shows
 * up as an installer that confidently writes a secret the application then
 * refuses, in someone else's deployment.
 *
 * So neither side knows about the other, and THIS FILE is where they meet: the
 * repository can reach both, so it generates from the real CLI module and
 * judges with the real application validator. If the floor moves and the
 * generator falls under it, this fails here.
 *
 * The margin is deliberately large rather than exact. 32 random bytes is far
 * above the shared minimum, so a future tightening of the policy is very
 * unlikely to invalidate already-generated secrets — and if it ever would,
 * that is a thing to find out in this suite rather than from an operator.
 */

/** Enough that a 1-in-N formatting accident would have to be very rare to hide. */
const SAMPLE = 200

describe("generated secrets satisfy the application's deployment-secret policy", () => {
  const secrets = Array.from({ length: SAMPLE }, () => generateDeploymentSecret())

  it(`classifies all ${SAMPLE} as usable`, () => {
    const rejected = secrets
      .map((secret) => ({ verdict: classifyDeploymentSecret(secret) }))
      .filter((entry) => entry.verdict.state !== "usable")
      // The REASON is safe to report; the value is not, and nothing here logs it.
      .map((entry) => entry.verdict.reason)

    expect(rejected).toEqual([])
  })

  it(`passes the AUTH_SECRET validator for all ${SAMPLE}`, () => {
    // The same floor, reached through the wrapper that actually guards startup.
    const failures = secrets.filter((secret) => !classifyAuthSecret(secret).ok)
    expect(failures).toHaveLength(0)
  })

  it("clears the length floor with room to spare", () => {
    // 43 characters against a 24-character minimum. The margin is what makes a
    // future tightening safe.
    for (const secret of secrets) expect(secret.length).toBeGreaterThanOrEqual(43)
  })

  it("clears the distinct-character floor with room to spare", () => {
    // The policy asks for 8. base64url over 32 random bytes gives far more, and
    // a generator that started emitting "aaaa…" would be caught here rather
    // than by a deployment refusing to become ready.
    for (const secret of secrets) expect(new Set(secret).size).toBeGreaterThanOrEqual(16)
  })

  it("trips no placeholder in the denylist", () => {
    for (const secret of secrets) {
      expect(classifyDeploymentSecret(secret).reason).toBeNull()
    }
  })
})

describe("the CLI stays a standalone package", () => {
  const CLI_SRC = join(process.cwd(), "packages", "create-flowcms", "src")

  /**
   * Source with comments removed, and only real import STATEMENTS matched.
   *
   * Both guards below read code rather than prose, for the same reason twice:
   * these modules document the rules they follow, and an error message that
   * contains the word "from" is not an import. The first draft of this test
   * reported that projectName.mjs imported "${raw}" — a fragment of an error
   * string — which is a failing test that proves nothing.
   */
  const IMPORT = /^\s*import\s[^"']*from\s+["']([^"']+)["']/gm

  const code = (source: string): string =>
    source
      .replace(new RegExp("/\\*[\\s\\S]*?\\*/", "g"), "")
      .replace(new RegExp("(^|[^:])//.*$", "gm"), "$1")

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry)
      return statSync(full).isDirectory() ? walk(full) : [full]
    })
  }

  const files = [
    ...walk(CLI_SRC),
    join(process.cwd(), "packages", "create-flowcms", "bin", "create-flowcms.mjs"),
  ]

  it("found the CLI's sources", () => {
    // A walk that matched nothing would let every assertion below pass on an
    // empty set.
    expect(files.length).toBeGreaterThanOrEqual(6)
  })

  it("imports nothing from the application", () => {
    // `@/Framework/…` resolves here and nowhere a published CLI will ever run.
    for (const file of files) {
      const source = readFileSync(file, "utf8")
      const rel = file.split(sep).slice(-2).join("/")
      expect(source, rel).not.toMatch(/from ["']@\//)
      expect(source, rel).not.toMatch(/from ["'](\.\.\/){2,}src\//)
    }
  })

  it("imports nothing outside Node's own modules", () => {
    // Zero dependencies is the design: an argument parser or a prompt library
    // would be a version to track and a supply chain to trust, bought for
    // something forty lines already does.
    // Node builtins, or a relative path within the package. The bin genuinely
    // imports `../src/cli.mjs`; what must not appear is a BARE specifier, which
    // would be a dependency, or a path reaching out of the package, which the
    // test above forbids separately.
    const allowed = /^node:|^\.\.?\//
    for (const file of files) {
      for (const match of code(readFileSync(file, "utf8")).matchAll(IMPORT)) {
        expect(match[1], `${file} imports ${match[1]}`).toMatch(allowed)
      }
    }
  })

  it("does not restate the entropy policy", () => {
    // The whole point of the meeting-place above: one place decides what
    // "strong" means, and it is not this package.
    for (const file of files) {
      const source = code(readFileSync(file, "utf8"))
      expect(source).not.toMatch(/MIN_DEPLOYMENT_SECRET/)
      expect(source).not.toMatch(/changeme|replace-me/i)
    }
  })
})
