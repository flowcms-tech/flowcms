import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { mkdtempSync, cpSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { DERIVED, SOURCES, readVersions } from "../../scripts/release-version-sync.mjs"

/**
 * VERSION SYNCHRONISATION HAS ONE OWNER.
 *
 * The FlowCMS release number lives in five committed files and one generated
 * one. Every release moves all six, and the way that goes wrong is always the
 * same: something moves five of them.
 *
 * It has gone wrong twice, both caught by running a real release rather than by
 * reading. `release-orchestrate.mjs` grew its own copy of "where the version
 * lives", and that copy forgot the root manifest and the lockfile — so CI
 * failed on `versionAlignment.test.ts` after the release branch already
 * existed. The fix was not to teach the second implementation about two more
 * files; it was to delete the second implementation.
 *
 * So these assertions are mostly about ownership and about the canonical /
 * derived split, which is the distinction the confusing failures came from.
 */

const ROOT = process.cwd()

describe("the canonical sources", () => {
  it("covers every committed file that carries the release number", () => {
    /**
     * The list `tests/packaging/versionAlignment.test.ts` enforces, plus the
     * lockfile it does not. A file carrying the version and missing from here
     * is a file a release will silently leave behind.
     */
    expect(SOURCES.map((s) => s.path).sort()).toEqual(
      [
        "package-lock.json",
        "package.json",
        "packages/create-flowcms/package.json",
        "packages/flowcms/package.json",
        "src/Themes/contract/version.ts",
      ].sort(),
    )
  })

  it("includes the root manifest, which it used to refuse to touch", () => {
    /**
     * THE DEFECT THIS PINS. This script's header once said it would not touch
     * the root `package.json` because `flowcms-app` is private. But
     * `versionAlignment.test.ts` requires it to equal FLOWCMS_VERSION, and
     * every release since 0.2.0 moved it. Two files disagreeing about whether
     * the root version matters is what a release tears open.
     */
    expect(SOURCES.map((s) => s.path)).toContain("package.json")
  })

  it("reads every source at the same version in this checkout", () => {
    const versions = readVersions()
    expect(versions.every((s) => s.version), "a source read as undefined").toBe(true)
    expect(new Set(versions.map((s) => s.version)).size, JSON.stringify(versions)).toBe(1)
  })
})

describe("the lockfile's two mirrors", () => {
  const lockfile = SOURCES.find((s) => s.path === "package-lock.json")!

  it("reads the version only when both fields agree", () => {
    const both = JSON.stringify({ version: "1.2.3", packages: { "": { version: "1.2.3" } } })
    expect(lockfile.read(both)).toBe("1.2.3")
  })

  it("writes both fields, never just the top one", () => {
    /**
     * Editing the manifest alone leaves the lockfile a version behind, and
     * editing the lockfile's top-level field alone leaves `packages[""]`
     * behind. Both are the same defect one file down.
     */
    const before = `${JSON.stringify(
      { name: "flowcms-app", version: "1.2.3", packages: { "": { version: "1.2.3" } } },
      null,
      2,
    )}\n`
    const after = JSON.parse(lockfile.write(before, "1.2.4"))
    expect(after.version).toBe("1.2.4")
    expect(after.packages[""].version).toBe("1.2.4")
  })

  it("round-trips this repository's real lockfile without reformatting it", () => {
    // The write path rewrites the whole file through JSON.stringify. If npm's
    // formatting ever stopped matching, every release would produce a diff of
    // the entire lockfile with two meaningful lines buried in it.
    const original = readFileSync(join(ROOT, "package-lock.json"), "utf8")
    const parsed = JSON.parse(original)
    expect(`${JSON.stringify(parsed, null, 2)}\n`).toBe(original)
  })
})

describe("the derived artifact is not a canonical source", () => {
  it("is excluded from the sources that must agree", () => {
    expect(SOURCES.map((s) => s.path)).not.toContain(DERIVED.path)
    expect(DERIVED.path).toBe("packages/create-flowcms/template.json")
  })

  it("names the builder that regenerates it", () => {
    // `--set` runs this rather than telling the operator to run a second
    // command, which is the step that was actually being forgotten.
    expect(DERIVED.builder).toBe("scripts/build-create-flowcms.mjs")
  })

  it("is gitignored, which is why its staleness cannot bind a release", () => {
    /**
     * THE CONFUSING FAILURE THIS PREVENTS. A stale generated template used to
     * make check mode exit 1, so switching branches was enough to make a
     * release refuse to start, naming a file no commit contains and that no
     * hand had edited.
     */
    const ignored = execFileSync("git", ["check-ignore", DERIVED.path], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim()
    expect(ignored).toBe(DERIVED.path)
  })
})

describe("check mode, against a temporary copy of the real sources", () => {
  /**
   * Run as a subprocess against a throwaway tree. The script exits the process,
   * so it cannot be exercised in-process, and a fixture keeps these cases from
   * touching the working repository.
   */
  function run(mutate: (dir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), "flowcms-vsync-"))
    try {
      cpSync(join(ROOT, "scripts"), join(dir, "scripts"), { recursive: true })
      for (const source of SOURCES) {
        const target = join(dir, source.path)
        cpSync(join(ROOT, source.path), target, { recursive: true })
      }
      mutate(dir)
      try {
        return {
          code: 0,
          out: execFileSync(process.execPath, [join(dir, "scripts/release-version-sync.mjs")], {
            cwd: dir,
            encoding: "utf8",
            stdio: "pipe",
          }),
        }
      } catch (error) {
        const e = error as { status: number; stdout: string; stderr: string }
        return { code: e.status, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it("passes when the committed sources agree and the derived file is absent", () => {
    // A clean checkout has no template.json at all. That must not be a failure.
    const { code, out } = run(() => {})
    expect(out).toMatch(/every committed source says/)
    expect(code).toBe(0)
  })

  it("does NOT fail on a stale derived template", () => {
    /**
     * The regression that made a release refuse to start after a branch switch.
     * It must report and continue, not exit 1.
     */
    const { code, out } = run((dir) => {
      writeFileSync(
        join(dir, DERIVED.path),
        `${JSON.stringify({ templateVersion: "0.0.1" }, null, 2)}\n`,
      )
    })
    expect(out, "a stale generated file was treated as a blocker").toMatch(/not a release blocker/)
    expect(code).toBe(0)
  })

  it("still fails when a committed source disagrees", () => {
    const { code, out } = run((dir) => {
      const p = join(dir, "package.json")
      const parsed = JSON.parse(readFileSync(p, "utf8"))
      parsed.version = "9.9.9"
      writeFileSync(p, `${JSON.stringify(parsed, null, 2)}\n`)
    })
    expect(out).toMatch(/committed version sources disagree/)
    expect(code).toBe(1)
  })

  it("fails when the lockfile disagrees with itself", () => {
    const { code, out } = run((dir) => {
      const p = join(dir, "package-lock.json")
      const parsed = JSON.parse(readFileSync(p, "utf8"))
      parsed.packages[""].version = "9.9.9"
      writeFileSync(p, `${JSON.stringify(parsed, null, 2)}\n`)
    })
    expect(out).toMatch(/disagrees with itself/)
    expect(code).toBe(1)
  })
})

describe("the orchestrator does not reimplement any of this", () => {
  const orchestrator = readFileSync(join(ROOT, "scripts/release-orchestrate.mjs"), "utf8")

  it("delegates the bump rather than editing manifests", () => {
    expect(orchestrator).toMatch(/release-version-sync\.mjs", "--set"/)
    // No manifest or lockfile writing of its own. `writeFileSync` appearing here
    // again is the second implementation growing back.
    expect(orchestrator, "the orchestrator writes files during a bump").not.toMatch(
      /writeFileSync/,
    )
    expect(orchestrator, "the orchestrator rewrites the lockfile itself").not.toMatch(
      /packages\?\.\[""\]/,
    )
  })

  it("verifies through the owner's own reader", () => {
    expect(orchestrator).toMatch(/import \{ readVersions \} from "\.\/release-version-sync\.mjs"/)
    expect(orchestrator).toMatch(/readVersions\(\)/)
  })
})
