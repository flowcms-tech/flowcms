import { describe, expect, it } from "vitest"
import * as hygiene from "../../scripts/verify-artifact-hygiene.mjs"

/**
 * THE DENY LIST, TESTED WITHOUT PACKING ANYTHING.
 *
 * `scripts/verify-artifact-hygiene.mjs` splits into a pure classifier and a
 * thin CLI precisely so this file can exist: the interesting part is which
 * paths are refused, and answering that should not require npm, a build, or a
 * filesystem.
 *
 * The cases below are written as the questions a reviewer would ask — "would
 * this stop a `.env`? would it stop somebody's database? would it stop the one
 * file that must NOT be stopped?" — because a deny list nobody can read is a
 * deny list somebody eventually widens to make a build go green.
 *
 * The script is plain ESM, so its exports are re-declared here with the shapes
 * this suite relies on. That is the same arrangement
 * `tests/config/migrateParity.test.ts` uses for `scripts/migrate.mjs`.
 */

interface DenyRule {
  id: string
  pattern: RegExp
  why: string
}

interface Violation {
  file: string
  rule: string
  why: string
  package?: string
}

interface ClassifyInput {
  packageName?: string
  files: string[]
  allow?: RegExp | null
  envExampleUnder?: RegExp | null
  extraDeny?: DenyRule[]
}

interface ClassifyResult {
  violations: Violation[]
  strays: string[]
}

interface PackageSpec {
  name: string
  dir: string
  requires: string[]
  requiresHint: string
  allow: RegExp
  envExampleUnder: RegExp | null
  extraDeny?: DenyRule[]
}

const DENY_RULES = hygiene.DENY_RULES as unknown as DenyRule[]
const CONTENT_RULES = hygiene.CONTENT_RULES as unknown as DenyRule[]
const PACKAGES = hygiene.PACKAGES as unknown as PackageSpec[]
const classifyPackedFiles = hygiene.classifyPackedFiles as unknown as (
  input: ClassifyInput,
) => ClassifyResult
const scanTextForLeaks = hygiene.scanTextForLeaks as unknown as (text: string) => string[]

type Options = Omit<Partial<ClassifyInput>, "files">

const classify = (files: string[], options: Options = {}): ClassifyResult =>
  classifyPackedFiles({ packageName: "test", files, ...options })

const ruleFor = (file: string, options: Options = {}): string | null => {
  const { violations } = classify([file], options)
  return violations.length ? violations[0].rule : null
}

describe("secrets and environment files", () => {
  it.each([
    ".env",
    ".env.local",
    ".env.production",
    "src/.env",
    "template/.env",
    "template/.env.local",
  ])("refuses %s", (file) => {
    expect(ruleFor(file)).not.toBeNull()
  })

  it("refuses .env.example by default", () => {
    // A library has no use for one. Only create-flowcms is granted the
    // exception, and only under template/.
    expect(ruleFor(".env.example")).toBe("env-example")
    expect(ruleFor("template/.env.example")).toBe("env-example")
  })

  it("permits .env.example only inside the directory that is granted it", () => {
    const under: Options = { envExampleUnder: /^template\// }
    // THE ONE DELIBERATE EXCEPTION. A generated project without .env.example
    // has no documentation for the variables it needs, and docs/docker.md tells
    // the operator to copy it. It carries no values: every secret in it is a
    // placeholder the application refuses at startup, on purpose.
    expect(ruleFor("template/.env.example", under)).toBeNull()
    // …and nowhere else, not even inside the same package.
    expect(ruleFor(".env.example", under)).toBe("env-example")
    expect(ruleFor("src/.env.example", under)).toBe("env-example")
    // The exception is for the example only. A real one is still refused.
    expect(ruleFor("template/.env", under)).toBe("env-file")
  })

  it("refuses the local credentials scratch file by name", () => {
    // Named, never opened — and the classifier could not open it if it wanted
    // to, because it is handed paths and returns rule ids.
    expect(ruleFor("data-info.txt")).toBe("local-credentials")
    expect(ruleFor("template/data-info.txt")).toBe("local-credentials")
  })

  it.each([
    "id_rsa",
    "id_ed25519",
    ".ssh/id_rsa.pub",
    "certs/server.pem",
    "certs/server.key",
    "keystore.p12",
    "bundle.pfx",
  ])("refuses the private key or certificate %s", (file) => {
    expect(ruleFor(file)).toBe("private-key")
  })

  it.each([".npmrc", ".netrc", "credentials.json", "secrets.yml", "config/credential-store.js"])(
    "refuses the credentials file %s",
    (file) => {
      expect(ruleFor(file)).toMatch(/^credential/)
    },
  )
})

describe("databases and repository state", () => {
  it.each(["data/app.db", "app.sqlite", "app.sqlite3", "data/app.db-wal", "data/app.db-shm"])(
    "refuses the database file %s",
    (file) => {
      expect(ruleFor(file)).toBe("database")
    },
  )

  it("refuses repository history but not a .gitignore", () => {
    expect(ruleFor(".git/config")).toBe("vcs")
    expect(ruleFor(".git/HEAD")).toBe("vcs")
    // `.gitignore` ships deliberately inside the create-flowcms template — npm
    // renames it in transit, which is the whole reason it is handled with care
    // rather than blanket-ignored.
    expect(ruleFor("template/.gitignore")).toBeNull()
  })

  it.each([
    "node_modules/react/index.js",
    "template/node_modules/.package-lock.json",
    "flowcms-0.1.0.tgz",
    ".next/BUILD_ID",
    "coverage/lcov.info",
    "tsconfig.tsbuildinfo",
    "debug.log",
  ])("refuses the build or dependency artefact %s", (file) => {
    expect(ruleFor(file)).not.toBeNull()
  })

  it.each([".claude/settings.json", ".cursor/rules.md", ".idea/modules.xml", ".vscode/launch.json"])(
    "refuses the local tooling directory entry %s",
    (file) => {
      expect(ruleFor(file)).toBe("agent-tooling")
    },
  )
})

describe("internal documents", () => {
  it.each([
    "CLAUDE.md",
    "AGENTS.md",
    "PROJECT_DOCUMENTATION.md",
    "template/CLAUDE.md",
    "MAINTAINERS.md",
  ])("refuses the maintainer-facing document %s", (file) => {
    expect(ruleFor(file)).toBe("internal-notes")
  })

  it.each([
    "docs/superpowers/plans/2026-08-24-ci.md",
    "docs/implementation-reports/phase-8/8.3-ci-release-gates.md",
    "docs/superpowers/specs/foundation-design.md",
  ])("refuses the internal design note %s", (file) => {
    expect(ruleFor(file)).not.toBeNull()
  })

  it("refuses repository tooling and the test suite", () => {
    expect(ruleFor("publish-guard.mjs")).toBe("repo-tooling")
    expect(ruleFor("vitest.config.ts")).toBe("repo-tooling")
    expect(ruleFor("tests/auth/permissions.test.ts")).toBe("test-suite")
    expect(ruleFor("test/helper.js")).toBe("test-suite")
  })
})

describe("the allowlist is what actually holds", () => {
  it("reports a stray even when no deny rule names it", () => {
    const { violations, strays } = classify(["dist/index.js", "notes.rtf", "package.json"], {
      allow: /^(dist\/|package\.json$|README\.md$)/,
    })
    expect(violations).toEqual([])
    expect(strays).toEqual(["notes.rtf"])
  })

  it("passes a clean library artefact", () => {
    const { violations, strays } = classify(
      ["dist/index.js", "dist/index.d.ts", "package.json", "README.md"],
      { allow: /^(dist\/|package\.json$|README\.md$)/ },
    )
    expect(violations).toEqual([])
    expect(strays).toEqual([])
  })

  it("applies a package's extra rules alongside the shared ones", () => {
    const create = PACKAGES.find((p) => p.name === "create-flowcms")
    expect(create, "create-flowcms is missing from PACKAGES").toBeDefined()
    expect(
      ruleFor("template/packages/flowcms-theme-aurora/package.json", {
        extraDeny: create?.extraDeny ?? [],
      }),
    ).toBe("example-fixture")
  })
})

describe("the phase's required categories are all covered", () => {
  const ids = new Set(DENY_RULES.map((r) => r.id))

  it.each([
    ["env-file", ".env / .env.local"],
    ["env-example", ".env.example, deliberately scoped rather than blanket-allowed"],
    ["database", "database files"],
    ["credential-file", "credential files"],
    ["local-credentials", "data-info.txt"],
    ["private-key", "private keys"],
    ["vcs", ".git"],
    ["node-modules", "node_modules"],
    ["internal-docs", "internal design notes"],
    ["internal-notes", "maintainer notes"],
  ])("covers %s — %s", (id) => {
    expect(ids.has(id)).toBe(true)
  })

  it("gives every rule a reason a maintainer can act on", () => {
    for (const rule of DENY_RULES) {
      expect(rule.why.length, `${rule.id} has a trivial reason`).toBeGreaterThan(15)
      expect(rule.pattern).toBeInstanceOf(RegExp)
      // A /g regex carries lastIndex between .test() calls and would start
      // skipping files at random — a leak gate that misses every other file.
      expect(rule.pattern.global, `${rule.id} is a /g regex`).toBe(false)
    }
  })

  it("reports only names and rules, never content", () => {
    const { violations } = classify([".env"])
    expect(Object.keys(violations[0]).sort()).toEqual(["file", "package", "rule", "why"])
  })
})

describe("build-machine paths embedded in shipped text", () => {
  it.each([
    ['import x from "C:/Users/someone/project/dist/index.js"', "windows-user-path"],
    ['require("C:\\\\Users\\\\someone\\\\project")', "windows-user-path"],
    ['import("/home/someone/flowcms/src/Themes/contract")', "posix-home-path"],
    ['from "/Users/someone/flowcms/src"', "posix-home-path"],
    ["at /home/runner/work/flowcms/flowcms/src", "ci-workspace-path"],
    ['import type { X } from "@/Themes/contract"', "internal-alias"],
  ])("flags %s", (text, expected) => {
    expect(scanTextForLeaks(text)).toContain(expected)
  })

  it("returns rule ids, never the matched text", () => {
    const ids = scanTextForLeaks('import x from "C:/Users/someone/secret-project/index.js"')
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(id).not.toMatch(/secret-project/)
      expect(CONTENT_RULES.some((r) => r.id === id)).toBe(true)
    }
  })

  it("leaves ordinary shipped code alone", () => {
    expect(scanTextForLeaks('export * from "./theme.js"')).toEqual([])
    expect(scanTextForLeaks('const url = "https://example.com/home/page"')).toEqual([])
    expect(scanTextForLeaks("const cls = clsx(a, b)")).toEqual([])
  })
})

describe("the gate refuses to grade an artefact that was never built", () => {
  it("names a required build output and the command that produces it, for every package", () => {
    expect(PACKAGES.length).toBe(3)
    for (const pkg of PACKAGES) {
      // Without this, an unbuilt package packs a manifest describing nothing
      // and the gate reports a clean bill of health for an artefact that does
      // not exist — a green check mark attached to nothing.
      expect(pkg.requires.length, `${pkg.name} declares no required build output`).toBeGreaterThan(0)
      expect(pkg.requiresHint, `${pkg.name} does not say how to build it`).toMatch(/scripts\//)
      expect(pkg.allow, `${pkg.name} has no shipping allowlist`).toBeInstanceOf(RegExp)
    }
  })

  it("grants the .env.example exception to exactly one package", () => {
    const granted = PACKAGES.filter((p) => p.envExampleUnder)
    expect(granted.map((p) => p.name)).toEqual(["create-flowcms"])
  })
})
