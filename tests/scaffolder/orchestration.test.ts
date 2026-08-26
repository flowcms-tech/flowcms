import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { main, run } from "../../packages/create-flowcms/src/cli.mjs"

/**
 * Nearly every test here copies the whole application template — 695 files.
 * That is the point: it is the real copy path rather than a stub. It is also
 * slower than the suite's 20-second default on a filesystem with a virus
 * scanner in front of it, and the first version of this file timed out on the
 * one test that happened to run first.
 *
 * Set for the whole file rather than per test. Half the tests here copy and
 * half do not, and a suite where the difference is a trailing argument someone
 * has to remember is a suite that goes flaky the next time one is added.
 */
const COPY_TIMEOUT = 120_000
vi.setConfig({ testTimeout: COPY_TIMEOUT })

/**
 * WHAT HAPPENS WHEN A STEP FAILS.
 *
 * The two decisions this file exists for are both about somebody else's
 * filesystem, and both are the kind of thing that is only ever discovered the
 * hard way:
 *
 *   - a failed INSTALL must leave the project standing. It is complete and
 *     worth keeping; the fix is one command, and deleting an operator's new
 *     project because a registry was briefly unreachable is unforgivable.
 *   - a failed COPY must remove only what this process created. Scaffolding
 *     into an empty directory the operator made is supported, and removing THAT
 *     directory destroys something we were handed rather than something we made.
 *
 * The package manager is injected, so none of this needs npm, a registry or a
 * network. The real thing runs in `scripts/verify-create-flowcms.mjs`.
 *
 * These exercise the template on disk, so they need it built — `npm test` does
 * that first.
 */

const temporary: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cf-orch-"))
  temporary.push(dir)
  return dir
}
afterEach(() => {
  while (temporary.length > 0) rmSync(temporary.pop()!, { recursive: true, force: true })
})

/** Collects output instead of printing it, and lets a test read it back. */
function recorder() {
  const out: string[] = []
  const err: string[] = []
  return {
    io: {
      log: (m: unknown = "") => {
        out.push(String(m))
      },
      error: (m: unknown = "") => {
        err.push(String(m))
      },
    },
    stdout: () => out.join("\n"),
    stderr: () => err.join("\n"),
  }
}

const available = { isAvailable: async () => true }

/**
 * The deployment answers, as flags.
 *
 * Phase 7.4 made configuration part of scaffolding, and a non-interactive run
 * REFUSES TO GUESS at infrastructure — so every test that reaches the copy
 * step now has to answer the same questions an operator in CI answers. They
 * are passed as flags rather than stubbed, which keeps the real resolver and
 * the real validation inside the path being tested.
 *
 * Split in two because three tests choose their own package manager, and a
 * flag supplied twice is a usage error rather than an override.
 */
const DEPLOYMENT = ["--deployment", "docker", "--database", "sqlite", "--storage", "garage", "--redis", "none"]
const NON_INTERACTIVE = [...DEPLOYMENT, "--package-manager", "npm"]

describe("a successful scaffold", () => {
  it("creates the project and reports how to finish it", async () => {
    const parent = tempDir()
    const target = join(parent, "my-site")
    const { io, stdout } = recorder()

    const code = await run([target, ...NON_INTERACTIVE, "--skip-install"], io)

    expect(code).toBe(0)
    expect(existsSync(join(target, "package.json"))).toBe(true)
    expect(existsSync(join(target, "src", "app", "layout.tsx"))).toBe(true)
    expect(stdout()).toMatch(/Skipping dependency installation/)
    expect(stdout()).toMatch(/npm install/)
    expect(stdout()).toMatch(/\.env/)
  })

  it("names the project after its directory", async () => {
    const parent = tempDir()
    const target = join(parent, "My Site")
    const { io } = recorder()

    await run([target, ...NON_INTERACTIVE, "--skip-install"], io)

    expect(JSON.parse(readFileSync(join(target, "package.json"), "utf8")).name).toBe("my-site")
  })

  it("scaffolds into an empty directory the operator already made", async () => {
    const parent = tempDir()
    const target = join(parent, "prepared")
    mkdirSync(target)
    const { io } = recorder()

    expect(await run([target, ...NON_INTERACTIVE, "--skip-install"], io)).toBe(0)
    expect(existsSync(join(target, "package.json"))).toBe(true)
  })

  it("prints no secret", async () => {
    // Phase 7.4 decides what an installer does with generated secrets. Until
    // then nothing generates one during scaffolding, and nothing prints one.
    const parent = tempDir()
    const { io, stdout, stderr } = recorder()

    await run([join(parent, "site"), ...NON_INTERACTIVE, "--skip-install"], io)

    for (const stream of [stdout(), stderr()]) {
      expect(stream).not.toMatch(/AUTH_SECRET=\S/)
      expect(stream).not.toMatch(/[A-Za-z0-9_-]{40,}/)
    }
  })
})

describe("when dependency installation fails", () => {
  it("KEEPS the project and says how to finish it", async () => {
    const parent = tempDir()
    const target = join(parent, "my-site")
    const { io, stderr } = recorder()

    const code = await run([target, ...NON_INTERACTIVE], io, {
      ...available,
      installDependencies: async () => ({ code: 1 }),
    })

    expect(code).toBe(1)
    // The project is complete. A registry outage is not a reason to delete it.
    expect(existsSync(join(target, "package.json"))).toBe(true)
    expect(existsSync(join(target, "src", "app", "layout.tsx"))).toBe(true)
    expect(stderr()).toMatch(/has been kept/)
    expect(stderr()).toMatch(/npm install/)
  })

  it("does not claim success", async () => {
    const parent = tempDir()
    const { io, stdout } = recorder()

    await run([join(parent, "site"), ...NON_INTERACTIVE], io, {
      ...available,
      installDependencies: async () => ({ code: 1 }),
    })

    expect(stdout()).not.toMatch(/^Created /m)
  })

  it("reports success only when the install actually succeeded", async () => {
    const parent = tempDir()
    const { io, stdout } = recorder()

    const code = await run([join(parent, "site"), ...NON_INTERACTIVE], io, {
      ...available,
      installDependencies: async () => ({ code: 0 }),
    })

    expect(code).toBe(0)
    expect(stdout()).toMatch(/Created site in/)
  })
})

describe("when the package manager is missing", () => {
  it("fails BEFORE creating anything", async () => {
    const parent = tempDir()
    const target = join(parent, "my-site")
    const { io } = recorder()

    const code = await main([target, ...DEPLOYMENT, "--package-manager", "pnpm"], io, {
      isAvailable: async () => false,
      installDependencies: async () => ({ code: 0 }),
    })

    expect(code).toBe(2)
    // Nothing was written, so there is nothing for the operator to clean up.
    expect(existsSync(target)).toBe(false)
  })

  it("names the manager and the ways out", async () => {
    const parent = tempDir()
    const { io, stderr } = recorder()

    await main([join(parent, "site"), ...DEPLOYMENT, "--package-manager", "yarn"], io, {
      isAvailable: async () => false,
      installDependencies: async () => ({ code: 0 }),
    })

    expect(stderr()).toMatch(/yarn/)
    expect(stderr()).toMatch(/--skip-install/)
    // Never a silent fallback: installing with npm when somebody asked for yarn
    // produces a lockfile they did not want and will not notice.
    expect(stderr()).not.toMatch(/falling back|using npm instead/i)
  })

  it("does not ask when installation was skipped anyway", async () => {
    const parent = tempDir()
    const target = join(parent, "site")
    const { io } = recorder()

    const code = await run([target, ...DEPLOYMENT, "--package-manager", "bun", "--skip-install"], io, {
      isAvailable: async () => {
        throw new Error("availability must not be probed when --skip-install is passed")
      },
      installDependencies: async () => ({ code: 0 }),
    })

    expect(code).toBe(0)
    expect(existsSync(join(target, "package.json"))).toBe(true)
  })
})

describe("destination refusals leave the filesystem alone", () => {
  it("refuses a non-empty directory without touching it", async () => {
    const parent = tempDir()
    const target = join(parent, "busy")
    mkdirSync(target)
    writeFileSync(join(target, "their-work.txt"), "irreplaceable")
    const { io, stderr } = recorder()

    const code = await main([target, ...NON_INTERACTIVE, "--skip-install"], io)

    expect(code).toBe(2)
    expect(stderr()).toMatch(/not empty/)
    expect(readdirSync(target)).toEqual(["their-work.txt"])
    expect(readFileSync(join(target, "their-work.txt"), "utf8")).toBe("irreplaceable")
  })

  it("returns 2 for a usage error and 1 for anything else", async () => {
    const { io } = recorder()
    expect(await main(["--not-a-flag"], io)).toBe(2)
    expect(await main([], io)).toBe(2)
  })

  it("answers --help and --version with 0", async () => {
    const { io, stdout } = recorder()
    expect(await main(["--help"], io)).toBe(0)
    expect(await main(["--version"], io)).toBe(0)
    expect(stdout()).toMatch(/create-flowcms <project-directory>/)
    expect(stdout()).toMatch(/^\d+\.\d+\.\d+$/m)
  })
})

describe("when the copy fails partway", () => {
/**
   * A REAL failure of the copy step: the CLI is pointed at a template directory
   * that is not there, so `copyTemplate` throws AFTER the destination has been
   * created — which is the only way to reach the cleanup branch.
   *
   * Two earlier attempts were worse, and both are worth remembering.
   *
   * The first put a FILE named `src` inside the empty destination, expecting
   * the directory copy to collide with it. It never got that far: a file makes
   * the directory non-empty, so validation refused it first and the test was
   * quietly exercising the wrong thing.
   *
   * The second renamed the CLI's real template directory aside and back. That
   * worked alone and failed with EPERM under `npm test`, because another test
   * file was reading the same directory at the same time — a shared mutable
   * fixture wearing an injection's clothes.
   */
  const missingTemplate = { templateDir: join(tmpdir(), "create-flowcms-template-that-is-not-there") }

  it("EMPTIES a directory the operator provided, and never removes it", async () => {
      const parent = tempDir()
      const target = join(parent, "provided")
      mkdirSync(target)
      const { io, stderr } = recorder()

    const code = await main([target, ...NON_INTERACTIVE, "--skip-install"], io, missingTemplate)

    expect(code).toBe(1)
    expect(stderr()).toMatch(/template/i)

      // THE GUARANTEE: the directory the operator handed over still exists.
      // Removing it would destroy something we were given rather than
      // something we made.
      expect(existsSync(target)).toBe(true)
      // And nothing half-written is left in it.
    expect(readdirSync(target)).toEqual([])
  })

  it("REMOVES a directory it created itself", async () => {
      const parent = tempDir()
      const target = join(parent, "ours")
      const { io } = recorder()

    const code = await main([target, ...NON_INTERACTIVE, "--skip-install"], io, missingTemplate)

    expect(code).toBe(1)
      // We made it, so we clean it up completely — no empty directory left
      // behind for the operator to wonder about.
    expect(existsSync(target)).toBe(false)
  })

  it("merges a partial override with the real collaborators", async () => {
    // `{ templateDir }` alone must still reach the real availability check and
    // the real installer. Before the merge this happened to work only because
    // --skip-install returns before `isAvailable` is called, which is the kind
    // of accident that holds until the day somebody writes the test that does
    // not pass --skip-install.
    const parent = tempDir()
    const target = join(parent, "partial")
    const { io } = recorder()

    let asked = false
    const code = await main([target, ...NON_INTERACTIVE], io, {
      ...missingTemplate,
      isAvailable: async () => {
        asked = true
        return true
      },
    })

    expect(asked).toBe(true)
    expect(code).toBe(1)
    expect(existsSync(target)).toBe(false)
  })

  it("leaves nothing behind when the destination is refused outright", async () => {
    const parent = tempDir()
    const target = join(parent, "made-by-us", "site")
    const { io } = recorder()

    // The parent of the destination does not exist, which is refused before any
    // write — the cheapest proof that a failing path creates no directory.
    expect(await main([target, ...NON_INTERACTIVE, "--skip-install"], io)).toBe(2)
    expect(existsSync(join(parent, "made-by-us"))).toBe(false)
  })
})
