import { afterEach, describe, expect, it } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, symlinkSync } from "node:fs"
import { homedir, hostname, tmpdir, userInfo } from "node:os"
import { join, resolve, sep } from "node:path"

import { HELP, PACKAGE_MANAGERS, UsageError, parseArgs } from "../../packages/create-flowcms/src/args.mjs"
import { assertInside, inspectDestination, isEmptyDirectory } from "../../packages/create-flowcms/src/destination.mjs"
import { deriveProjectName } from "../../packages/create-flowcms/src/projectName.mjs"
import {
  describeInstallCommand,
  getInstallCommand,
  installDependencies,
  isAvailable,
} from "../../packages/create-flowcms/src/packageManager.mjs"
import { generateDeploymentSecret } from "../../packages/create-flowcms/src/secrets.mjs"
import { cleanUpOwnedPath, renderPackageJson } from "../../packages/create-flowcms/src/scaffold.mjs"
import { buildProjectMarker } from "../../packages/create-flowcms/src/render/marker.mjs"

/**
 * `create-flowcms`, unit level.
 *
 * Everything here runs without a package manager, a registry or a network: the
 * child-process runner is injected, so what is exercised is the DECISIONS —
 * which command would be run, which path would be written, what happens when a
 * step fails. The expensive end-to-end proof (pack, install, build, Docker)
 * lives in `scripts/verify-create-flowcms.mjs`, because a unit suite that
 * installs from npm is a unit suite nobody can run on a train.
 */

const temporary: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cf-unit-"))
  temporary.push(dir)
  return dir
}

afterEach(() => {
  while (temporary.length > 0) rmSync(temporary.pop()!, { recursive: true, force: true })
})

describe("argument parsing", () => {
  it("takes a project directory", () => {
    expect(parseArgs(["my-site"])).toMatchObject({
      mode: "scaffold",
      directory: "my-site",
      skipInstall: false,
    })
  })

  it("leaves an unsupplied choice UNSET rather than defaulting it", () => {
    // Changed in Phase 7.4, and the distinction is what the interactive
    // installer runs on: "not chosen" is a question to ask, and "chosen to be
    // the default" is not. Defaults are applied once it is known whether
    // anybody can be asked — see DEFAULTS in config/model.mjs, where npm still
    // is the default.
    expect(parseArgs(["site"]).packageManager).toBeUndefined()
  })

  it.each(PACKAGE_MANAGERS)("accepts --package-manager %s", (manager) => {
    expect(parseArgs(["site", "--package-manager", manager]).packageManager).toBe(manager)
    expect(parseArgs(["site", `--package-manager=${manager}`]).packageManager).toBe(manager)
  })

  it("rejects an unknown package manager by name", () => {
    expect(() => parseArgs(["site", "--package-manager", "cargo"])).toThrow(
      /Unknown value "cargo" for --package-manager/,
    )
  })

  it("rejects --package-manager with no value", () => {
    expect(() => parseArgs(["site", "--package-manager"])).toThrow(/needs a value/)
  })

  it("supports --skip-install", () => {
    expect(parseArgs(["site", "--skip-install"]).skipInstall).toBe(true)
  })

  it.each([["-h"], ["--help"]])("%s is a successful outcome, not an error", (flag) => {
    expect(parseArgs([flag]).mode).toBe("help")
  })

  it.each([["-v"], ["--version"]])("%s is a successful outcome, not an error", (flag) => {
    expect(parseArgs([flag]).mode).toBe("version")
  })

  it("answers --help even without a project directory", () => {
    // Otherwise the first thing a new user types produces a usage error.
    expect(() => parseArgs(["--help"])).not.toThrow()
  })

  it("REFUSES an unknown flag rather than ignoring it", () => {
    // The failure this prevents: `--skipinstall` silently running an install
    // the operator asked it not to, with no symptom but a wait.
    expect(() => parseArgs(["site", "--skipinstall"])).toThrow(/Unknown option/)
    expect(() => parseArgs(["site", "--postgres"])).toThrow(/Unknown option/)
  })

  it("refuses a near-miss VALUE too, now that --database exists", () => {
    // `postgres` is not the dialect; `postgresql` is. A near miss accepted
    // would be a database nobody chose.
    expect(() => parseArgs(["site", "--database", "postgres"])).toThrow(/Unknown value/)
  })

  it("refuses a second positional argument", () => {
    expect(() => parseArgs(["one", "two"])).toThrow(/one project directory/)
  })

  it("requires a project directory", () => {
    expect(() => parseArgs([])).toThrow(UsageError)
    expect(() => parseArgs([])).toThrow(/Missing project directory/)
  })
})

describe("help output", () => {
  it("documents the usage, both flags and what comes next", () => {
    expect(HELP).toMatch(/create-flowcms <project-directory>/)
    expect(HELP).toMatch(/--package-manager/)
    expect(HELP).toMatch(/--skip-install/)
    expect(HELP).toMatch(/npm\|pnpm\|yarn\|bun/)
    // Phase 7.4 made deployment configuration part of scaffolding, which
    // retired the disclaimer this line used to check for. What matters now
    // is that the help NAMES the questions: an operator in CI reads it to
    // learn which flags a non-interactive run requires.
    expect(HELP).toMatch(/--deployment/)
    expect(HELP).toMatch(/--database/)
    expect(HELP).toMatch(/--storage/)
    expect(HELP).toMatch(/--redis/)
    expect(HELP).toMatch(/--admin-path/)
  })

  it("says what happens when a choice is not supplied", () => {
    // Phase 7.4 replaced the "no wizard yet" disclaimer with the actual rule:
    // asked in a terminal, refused without one, never guessed.
    expect(HELP).toMatch(/asked for when the terminal is interactive/i)
    expect(HELP).toMatch(/never guesses/i)
  })
})

describe("project name derivation", () => {
  it.each([
    ["my-site", "my-site"],
    ["My Site", "my-site"],
    ["My  Site", "my-site"],
    ["my_site", "my_site"],
    ["MySite", "mysite"],
    ["site.example.com", "site.example.com"],
    ["  spaced  ", "spaced"],
    ["-leading", "leading"],
    ["trailing-", "trailing"],
  ])("%j becomes %j", (directory, expected) => {
    expect(deriveProjectName(join("/tmp", directory))).toBe(expected)
  })

  it("refuses a name it would have to invent", () => {
    // Silently turning "🚀" into "project" hands somebody a name they did not
    // choose and would not guess.
    expect(() => deriveProjectName("/tmp/🚀")).toThrow(/Choose a directory name/)
    expect(() => deriveProjectName("/tmp/---")).toThrow(/Choose a directory name/)
  })

  it("refuses `flowcms`, and says why", () => {
    // npm refuses to install a package under a package of the same name — the
    // exact wall Phase 7.2 hit when the repository root was still `flowcms`.
    // Failing here beats failing inside `npm install` with a message about
    // neither.
    expect(() => deriveProjectName("/tmp/flowcms")).toThrow(/same name/)
  })

  it("refuses npm's own reserved names", () => {
    expect(() => deriveProjectName("/tmp/node_modules")).toThrow(/reserves/)
    expect(() => deriveProjectName("/tmp/favicon.ico")).toThrow(/reserves/)
  })

  it("refuses a name past npm's length limit", () => {
    expect(() => deriveProjectName(join("/tmp", "a".repeat(215)))).toThrow(/too long/)
  })
})

describe("destination validation", () => {
  it("accepts a path that does not exist yet", () => {
    const parent = tempDir()
    const result = inspectDestination(join(parent, "my-site"))
    expect(result.existed).toBe(false)
    expect(result.path).toBe(resolve(parent, "my-site"))
  })

  it("accepts an existing EMPTY directory", () => {
    const parent = tempDir()
    const target = join(parent, "empty")
    mkdirSync(target)
    expect(inspectDestination(target)).toMatchObject({ existed: true })
  })

  it("REFUSES a non-empty directory, before writing anything", () => {
    const parent = tempDir()
    const target = join(parent, "busy")
    mkdirSync(target)
    writeFileSync(join(target, "README.md"), "someone's work")

    expect(() => inspectDestination(target)).toThrow(/not empty/)
    // And left it exactly as it was.
    expect(readdirSync(target)).toEqual(["README.md"])
  })

  it("refuses a file", () => {
    const parent = tempDir()
    const target = join(parent, "a-file")
    writeFileSync(target, "")
    expect(() => inspectDestination(target)).toThrow(/is a file/)
  })

  it("refuses a symlink even when it points at an empty directory", () => {
    // A stat-based check would follow it and write the project somewhere the
    // operator never named.
    const parent = tempDir()
    const real = join(parent, "real")
    const link = join(parent, "link")
    mkdirSync(real)
    try {
      symlinkSync(real, link, "junction")
    } catch {
      return // unprivileged Windows; the rule is asserted by the code path above
    }
    expect(() => inspectDestination(link)).toThrow(/symbolic link/)
  })

  it("refuses the filesystem root", () => {
    expect(() => inspectDestination(resolve("/"))).toThrow(/filesystem root/)
  })

  it("refuses an empty or blank destination", () => {
    expect(() => inspectDestination("")).toThrow(/cannot be empty/)
    expect(() => inspectDestination("   ")).toThrow(/cannot be empty/)
  })

  it("refuses a missing parent rather than creating a tree from a typo", () => {
    const parent = tempDir()
    expect(() => inspectDestination(join(parent, "nope", "deeper", "site"))).toThrow(/does not exist/)
  })

  it("refuses the current directory when it is not empty", () => {
    const cwd = tempDir()
    writeFileSync(join(cwd, "file.txt"), "x")
    expect(() => inspectDestination(".", cwd)).toThrow(/current directory/)
  })

  it("resolves a relative path against the working directory", () => {
    const cwd = tempDir()
    expect(inspectDestination("./sub/../site", cwd).path).toBe(resolve(cwd, "site"))
  })

  it("accepts a path containing spaces and shell metacharacters", () => {
    // Nothing downstream hands a path to a shell, so these are ordinary names.
    const parent = tempDir()
    for (const name of ["my site", "site;rm -rf x", "site$(whoami)", "site&echo"]) {
      expect(inspectDestination(join(parent, name)).existed).toBe(false)
    }
  })

  it("ignores .DS_Store when deciding emptiness", () => {
    const dir = tempDir()
    writeFileSync(join(dir, ".DS_Store"), "")
    expect(isEmptyDirectory(dir)).toBe(true)
  })

  it("treats a directory holding a git repository as non-empty", () => {
    // It is somebody's project. Scaffolding into it is exactly the case the
    // rule refuses.
    const dir = tempDir()
    mkdirSync(join(dir, ".git"))
    expect(isEmptyDirectory(dir)).toBe(false)
  })
})

describe("template path safety", () => {
  it("allows an ordinary nested entry", () => {
    expect(assertInside("/base", "src/app/page.tsx")).toBe(resolve("/base", "src/app/page.tsx"))
  })

  it.each(["../escape", "../../etc/passwd", "src/../../outside"])(
    "refuses %j, which escapes the destination",
    (entry) => {
      expect(() => assertInside("/base", entry)).toThrow(/escapes the destination/)
    },
  )

  it("does not confuse a sibling with a child", () => {
    // "/base-other" starts with "/base" as a string but is not inside it.
    expect(() => assertInside("/base", "../base-other/file")).toThrow(/escapes/)
  })
})

describe("package manager commands", () => {
  it.each(PACKAGE_MANAGERS)("builds an argument ARRAY for %s", (manager) => {
    const { command, args } = getInstallCommand(manager)
    expect(Array.isArray(args)).toBe(true)
    expect(args).toEqual(["install"])
    expect(command).toMatch(new RegExp(`^${manager}(\\.cmd)?$`))
  })

  it("never produces a shell string", () => {
    for (const manager of PACKAGE_MANAGERS) {
      const { command, args } = getInstallCommand(manager)
      for (const part of [command, ...args]) {
        expect(part).not.toMatch(/[;&|$`><]/)
      }
    }
  })

  it("returns a fresh array each time, so a caller cannot mutate the table", () => {
    const first = getInstallCommand("npm")
    first.args.push("--force")
    expect(getInstallCommand("npm").args).toEqual(["install"])
  })

  it("passes the destination as cwd, never as part of the command", () => {
    // THE INJECTION TEST. A path full of shell syntax must arrive as an opaque
    // option, not as characters in a command line.
    const hostile = "/tmp/site; rm -rf $HOME"
    const seen: Array<{ command: string; args: string[]; options: { cwd?: string } }> = []
    const fakeRun = async (command: string, args: string[], options = {}) => {
      seen.push({ command, args, options })
      return { code: 0 }
    }

    return installDependencies("npm", hostile, fakeRun).then(() => {
      expect(seen).toHaveLength(1)
      expect(seen[0].args).toEqual(["install"])
      expect(seen[0].options.cwd).toBe(hostile)
      expect(seen[0].args.join(" ")).not.toContain("rm -rf")
    })
  })

  it("reports the command an operator would type", () => {
    expect(describeInstallCommand("pnpm")).toBe("pnpm install")
  })

  it("refuses to build a command for an unknown manager", () => {
    expect(() => getInstallCommand("cargo")).toThrow(/No install command/)
  })
})

describe("package manager availability", () => {
  it("is available when the probe exits 0", async () => {
    const run = async () => ({ code: 0 })
    expect(await isAvailable("pnpm", run)).toBe(true)
  })

  it("is unavailable when the probe exits non-zero", async () => {
    const run = async () => ({ code: 127 })
    expect(await isAvailable("pnpm", run)).toBe(false)
  })

  it("is unavailable when the binary cannot be spawned at all", async () => {
    // ENOENT rejects rather than resolving; a thrown error must not escape as
    // a crash with a stack trace about child_process.
    const run = async () => {
      throw Object.assign(new Error("spawn pnpm ENOENT"), { code: "ENOENT" })
    }
    expect(await isAvailable("pnpm", run)).toBe(false)
  })

  /**
   * THE ONE TEST HERE THAT USES THE REAL RUNNER, because the defect it pins was
   * invisible to every stubbed one.
   *
   * On Windows npm is `npm.cmd`, and since the fix for CVE-2024-27980 `spawn`
   * refuses to launch a `.cmd` without a shell — it fails with EINVAL. The
   * probe read that as "not installed", so `create-flowcms my-site` told every
   * Windows operator that the npm they had just invoked it with was missing.
   * Three stubbed tests passed throughout.
   *
   * npm is the one dependency this can assume: the suite is run through it.
   */
  it("finds the npm that is actually on PATH, using the real runner", async () => {
    expect(await isAvailable("npm")).toBe(true)
  })

  it("carries no platform-guessed file extension in the command", () => {
    // The old code appended `.cmd` on Windows for all four managers. bun ships
    // `bun.exe`, so that guess also reported bun as absent. Extension
    // resolution belongs to whatever launches the process.
    for (const manager of PACKAGE_MANAGERS) {
      expect(getInstallCommand(manager).command).toBe(manager)
    }
  })
})

describe("the generated package.json", () => {
  it("sets only name, version and private", () => {
    const dir = tempDir()
    const path = join(dir, "package.json")
    writeFileSync(
      path,
      JSON.stringify({
        name: "flowcms-site",
        version: "0.1.0",
        private: true,
        scripts: { build: "next build" },
        dependencies: { next: "16.2.6" },
        devDependencies: { flowcms: "file:packages/flowcms" },
      }),
    )

    const rendered = renderPackageJson(path, "my-site")

    expect(rendered.name).toBe("my-site")
    expect(rendered.private).toBe(true)
    expect(rendered.version).toBe("0.1.0")
    // The template is the application; the scaffolder has no opinion about it.
    expect(rendered.scripts).toEqual({ build: "next build" })
    expect(rendered.dependencies).toEqual({ next: "16.2.6" })
    expect(rendered.devDependencies).toEqual({ flowcms: "file:packages/flowcms" })
  })

  it("parses JSON rather than replacing text", () => {
    // A regex over a manifest is how a project named `next` gets its dependency
    // renamed along with it.
    const dir = tempDir()
    const path = join(dir, "package.json")
    writeFileSync(path, JSON.stringify({ name: "flowcms-site", dependencies: { "flowcms-site": "1.0.0" } }))

    const rendered = renderPackageJson(path, "renamed")
    expect(rendered.name).toBe("renamed")
    expect(rendered.dependencies["flowcms-site"]).toBe("1.0.0")
  })
})

describe("the project marker", () => {
  /**
   * The marker gained the deployment choices in Phase 7.4, so its shape is
   * asserted where those choices are built — `deploymentRender.test.ts`, which
   * also pins that no secret and no URL can appear in it.
   *
   * What stays here is the property that predates them and still holds: the
   * marker records what generated the project, and records nothing about the
   * machine that ran the command.
   */
  const marker = () =>
    buildProjectMarker(
      {
        deploymentMode: "docker",
        packageManager: "npm",
        database: "sqlite",
        storage: "garage",
        redis: "none",
        adminPath: "/admin",
        secrets: {},
      },
      { templateVersion: "0.1.0", cliVersion: "0.1.0" },
    )

  it("records the template and CLI versions", () => {
    expect(marker()).toMatchObject({
      templateVersion: "0.1.0",
      createdWith: "create-flowcms@0.1.0",
    })
  })

  it("carries no timestamp, path or machine identity", () => {
    // A creation time makes two identical scaffolds differ and is not something
    // any tool here would act on.
    const serialized = JSON.stringify(marker())
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}/)

    // No FILESYSTEM path and no machine identity. Banning the slash outright
    // stopped being the right check when the marker began recording
    // `adminPath`, which is a route the operator chose rather than a fact
    // about the machine that ran the installer — so this names what would
    // actually leak instead.
    expect(serialized).not.toMatch(/[A-Za-z]:\\|\\\\/)
    expect(serialized).not.toMatch(/\/(Users|home|tmp|var)\//)
    for (const identity of [homedir(), hostname(), userInfo().username]) {
      expect(serialized).not.toContain(identity)
    }
  })
})

describe("cleanup ownership", () => {
  it("removes a directory the scaffolder created", () => {
    const parent = tempDir()
    const target = join(parent, "created")
    mkdirSync(target)
    writeFileSync(join(target, "half-copied.txt"), "x")

    cleanUpOwnedPath({ path: target, existed: false })
    expect(existsSync(target)).toBe(false)
  })

  it("EMPTIES but never removes a directory the operator provided", () => {
    // They made it and handed it over. Deleting it because a copy failed
    // destroys something we were given rather than something we made.
    const parent = tempDir()
    const target = join(parent, "theirs")
    mkdirSync(target)
    writeFileSync(join(target, "half-copied.txt"), "x")

    cleanUpOwnedPath({ path: target, existed: true })
    expect(existsSync(target)).toBe(true)
    expect(readdirSync(target)).toEqual([])
  })

  it("does nothing when the path was never created", () => {
    const parent = tempDir()
    expect(() => cleanUpOwnedPath({ path: join(parent, "never"), existed: false })).not.toThrow()
  })
})

describe("the deployment secret generator", () => {
  it("produces a URL- and env-safe string", () => {
    // base64url: no padding to lose in a .env file, no character a shell would
    // treat as syntax.
    for (let i = 0; i < 20; i += 1) {
      expect(generateDeploymentSecret()).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it("carries at least 256 bits", () => {
    // 32 bytes as base64url is 43 characters.
    expect(generateDeploymentSecret().length).toBeGreaterThanOrEqual(43)
  })

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateDeploymentSecret()))
    expect(seen.size).toBe(500)
  })

  it("uses node:crypto, and nothing weaker", () => {
    // Math.random, a timestamp, a hostname or a counter have each shipped in
    // somebody's installer, and each turns "every deployment has its own key"
    // into "every deployment has the same key, or one you can guess".
    //
    // Comments stripped first: the module DOCUMENTS this rule and names every
    // forbidden call while doing so. A guard its own explanation trips is a
    // guard whoever hits it satisfies by deleting the explanation.
    const source = code(readFileSyncUtf8("packages/create-flowcms/src/secrets.mjs"))
    expect(source).toMatch(/from "node:crypto"/)
    expect(source).toMatch(/randomBytes\(/)
    expect(source).not.toMatch(/Math\.random/)
    expect(source).not.toMatch(/Date\.now|new Date/)
    expect(source).not.toMatch(/\bhostname\b/)
  })
})

/** Source with comments removed, so prose cannot trip or satisfy a guard. */
function code(source: string): string {
  const BLOCK = new RegExp("/\\*[\\s\\S]*?\\*/", "g")
  const LINE = new RegExp("(^|[^:])//.*$", "gm")
  return source.replace(BLOCK, "").replace(LINE, "$1")
}

/** Read a repository file as text. Kept local so the import list stays honest. */
function readFileSyncUtf8(relativePath: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:fs").readFileSync(join(process.cwd(), relativePath.split("/").join(sep)), "utf8")
}
