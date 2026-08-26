import { describe, expect, it } from "vitest"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "../../packages/create-flowcms/src/args.mjs"
import { applyDefaults, validateConfig } from "../../packages/create-flowcms/src/config/validate.mjs"
import { generateSecrets } from "../../packages/create-flowcms/src/config/secrets.mjs"
import {
  LOCKFILES,
  installCommandFor,
  needsCorepack,
  renderPackageManagerBlock,
} from "../../packages/create-flowcms/src/render/dockerfile.mjs"
import { buildReadme } from "../../packages/create-flowcms/src/render/readme.mjs"
import {
  writePackageManagerFields,
  writePnpmSettings,
} from "../../packages/create-flowcms/src/render/project.mjs"
import { getInstallCommand } from "../../packages/create-flowcms/src/packageManager.mjs"

/**
 * PACKAGE-MANAGER AND CROSS-PLATFORM PORTABILITY (Phase 8.4).
 *
 * `tests/scaffolder/deploymentRender.test.ts` already pins what each manager's
 * Dockerfile block SAYS. This file pins the things that are true of the project
 * as a whole and that a per-renderer test cannot see:
 *
 *   - nothing outside the rendered region assumes npm, in the Dockerfile or in
 *     the scripts a generated project runs during an image build;
 *   - the lockfile name has ONE source, so the README and the image build
 *     cannot disagree about which file the operator has to create;
 *   - the `packageManager` field is written only where it means something;
 *   - a `--` forwarded by whichever package manager invoked the CLI is not a
 *     usage error.
 *
 * All of it is static analysis and pure functions. Nothing here spawns a
 * package manager, builds an image, or needs a network — the cost of proving
 * these end to end is a CI matrix, which is Phase 8.4's handoff rather than its
 * implementation.
 */

const MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const

/**
 * Obviously fake external-storage credentials.
 *
 * A LOCAL deployment defaults to external S3 — FlowCMS has no local-filesystem
 * media backend — and `validateConfig` requires the five values for it. Without
 * them every `deploymentMode: "local"` fixture below would throw a ConfigError
 * about storage, turning a test about package managers into a test about
 * something else.
 */
const EXTERNAL_S3 = {
  endpoint: "https://s3.example.invalid",
  region: "us-east-1",
  bucket: "flowcms",
  accessKeyId: "EXAMPLE-ACCESS-KEY-ID",
  secretAccessKey: "EXAMPLE-SECRET-ACCESS-KEY-NOT-A-REAL-ONE",
}

function config(overrides: Record<string, unknown> = {}) {
  const defaults = applyDefaults({ projectName: "my-site", ...overrides })
  const partial =
    defaults.storage === "s3" && !defaults.externalStorage
      ? { ...defaults, externalStorage: EXTERNAL_S3 }
      : defaults
  return validateConfig({ ...partial, secrets: generateSecrets(partial) })
}

function repoFile(...parts: string[]) {
  return readFileSync(join(process.cwd(), ...parts), "utf8")
}

/**
 * A module's source with its commentary removed.
 *
 * Every "this module must NOT contain X" assertion below names a string the
 * module's own comments exist to explain: `packageManager.mjs` says at length
 * why it does not append a `.cmd` extension and why `shell: true` is never
 * passed, and it says it using the very spellings the assertions forbid.
 * Scanning the raw text would fail a file for documenting its reasoning, which
 * is the opposite of what these tests are for — so the reasoning goes first and
 * the assertions read the code.
 *
 * Block comments and whole-line `//` comments only. Nothing here needs to
 * understand a trailing comment or a `//` inside a string, and a stripper that
 * tried would be a parser.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n")
}

describe("the Dockerfile outside the rendered region", () => {
  /**
   * The builder stage runs the production build, and it is a DIFFERENT stage
   * from the one that installed the dependencies. `corepack enable` does not
   * survive across a stage, and the bun binary copied into `deps` is not in
   * `builder` either — so a `RUN pnpm run build` there would fail for the two
   * managers that need a shim and a `RUN bun run build` for the one that is not
   * installed. `RUN npm run build` happened to work only because the base image
   * carries npm regardless of what the operator chose.
   *
   * Invoking node directly is true for all four, and this pins it to the script
   * it is standing in for.
   */
  it("runs the production build through node, not through a package manager", () => {
    const dockerfile = repoFile("Dockerfile")
    const manifest = JSON.parse(repoFile("package.json")) as { scripts: Record<string, string> }

    expect(dockerfile).toContain(`RUN ${manifest.scripts.build}`)
    expect(dockerfile).not.toContain("RUN npm run build")
  })

  /**
   * THE FLAG ON THE `RUN` LINE DOES NOT REACH THE TYPE-CHECK WORKER.
   *
   * `node --max-old-space-size=4096` raises the heap of the process it starts.
   * Next forks a separate worker for the type-check phase, and a fork inherits
   * ENVIRONMENT rather than the parent's argv — so the worker took V8's default
   * heap (derived from container memory, ~2 GB) and died of a JS heap OOM while
   * the parent still had headroom it never touched. Only `ENV` is inheritable.
   *
   * Both belong in the file, so both are asserted: dropping the `ENV` brings the
   * OOM back, and dropping the flag unpins the RUN line from the `build` script
   * above.
   *
   * Phase 8.7 found this on the bun image build — the first one to survive far
   * enough to type-check, the earlier `@types/minimatch` failure having masked
   * it. The Dockerfile is identical for all four managers; it was never
   * bun-specific.
   */
  it("exports the heap limit to the build stage, so forked workers inherit it", () => {
    const dockerfile = repoFile("Dockerfile")
    expect(dockerfile).toContain("ENV NODE_OPTIONS=--max-old-space-size=4096")
  })

  /**
   * The runner must NOT carry it. The production server has no type-check
   * phase, and a 4 GB ceiling on a long-lived process is a footgun on a small
   * VPS: it lets a leak grow to 4 GB before Node reacts, instead of failing
   * early and visibly. A build-stage fix that drifts into the runtime stage is
   * the kind of change that looks harmless in a diff.
   */
  it("does not raise the heap limit in the runtime stage", () => {
    const dockerfile = repoFile("Dockerfile")
    const runnerAt = dockerfile.indexOf("FROM base AS runner")

    expect(runnerAt).toBeGreaterThan(-1)
    expect(dockerfile.slice(runnerAt)).not.toContain("NODE_OPTIONS")
  })

  /**
   * Every npm mention in the file has to be inside the region the installer
   * rewrites. One outside it is a command a pnpm, yarn or bun project would run
   * anyway, and the failure appears minutes into an image build.
   */
  it("mentions a package manager only inside the rendered region", () => {
    const dockerfile = repoFile("Dockerfile")
    const start = dockerfile.indexOf("# flowcms:render:package-manager")
    const end = dockerfile.indexOf("# flowcms:render:end")

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)

    const outside = dockerfile.slice(0, start) + dockerfile.slice(end)
    const offenders = outside
      .split("\n")
      .filter((line) => /^\s*RUN\b/.test(line))
      .filter((line) => /\b(npm|pnpm|yarn|bunx?)\b/.test(line))

    expect(offenders).toEqual([])
  })
})

describe("scripts a generated project runs during its image build", () => {
  /**
   * THE DEFECT THIS EXISTS FOR: `collect-db-drivers.mjs` read
   * `package-lock.json` by name. A generated project's lockfile is whichever
   * one its manager wrote, so for pnpm, yarn and bun the Docker build died with
   * ENOENT at a step three minutes in, naming a file the operator never asked
   * for. The closure now comes from `node_modules`, which all four produce.
   */
  it("names no lockfile", () => {
    // The file's header comment names all four lockfiles, explaining why it
    // reads none of them. The code is what must not mention one.
    const source = codeOnly(repoFile("scripts", "collect-db-drivers.mjs"))

    for (const lockfile of Object.values(LOCKFILES)) {
      expect(source).not.toContain(lockfile)
    }
  })

  it("resolves dependencies the way node does, so a non-hoisted layout works", () => {
    // pnpm's default layout leaves transitive dependencies under `.pnpm/` and
    // NOT at the top level, so `node_modules/<name>` is not a lookup that can
    // be assumed. Walking ancestors is what makes it work there.
    const source = codeOnly(repoFile("scripts", "collect-db-drivers.mjs"))
    expect(source).toContain("realpathSync")
    expect(source).toMatch(/node_modules/)
  })
})

describe("the lockfile name has one source", () => {
  it.each(MANAGERS)("the README and the image build agree for %s", (manager) => {
    const readme = buildReadme(config({ packageManager: manager, deploymentMode: "docker" }))
    const block = renderPackageManagerBlock(manager)
    const lockfile = LOCKFILES[manager]

    expect(readme).toContain(lockfile)
    expect(block).toContain(lockfile)

    // And no OTHER manager's lockfile is named anywhere in either.
    for (const other of MANAGERS.filter((name) => name !== manager)) {
      expect(readme).not.toContain(LOCKFILES[other])
      expect(block).not.toContain(LOCKFILES[other])
    }
  })

  it("uses bun.lock, not the binary bun.lockb", () => {
    // Bun 1.2 made the text lockfile the default and this repository's own is
    // `bun.lock`. `--frozen-lockfile` against the wrong filename is a build
    // that reinstalls rather than one that fails, which is worse.
    expect(LOCKFILES.bun).toBe("bun.lock")
  })
})

describe("the generated README never tells an operator to use another manager", () => {
  it.each(MANAGERS.filter((manager) => manager !== "npm"))("%s", (manager) => {
    const readme = buildReadme(config({ packageManager: manager, deploymentMode: "local" }))

    const npmCommands = readme
      .split("\n")
      .filter((line) => /(^|[`\s])npm (install|run|start|ci)\b/.test(line))

    expect(npmCommands).toEqual([])
    expect(readme).toContain(`${manager} install`)
  })

  it("states that the runtime is Node whatever the manager is", () => {
    for (const manager of MANAGERS) {
      const readme = buildReadme(config({ packageManager: manager }))
      expect(readme).toMatch(/runtime is Node/i)
    }
  })
})

describe("the frozen install command", () => {
  it.each(MANAGERS)("%s installs exactly what the lockfile pins", (manager) => {
    const command = installCommandFor(manager, { yarnMajor: 1 })
    expect(command).toMatch(/--frozen-lockfile|--immutable|\bci\b/)
  })

  it("uses yarn's v1 flag below v2 and its v2 flag above", () => {
    expect(installCommandFor("yarn", { yarnMajor: 1 })).toContain("--frozen-lockfile")
    expect(installCommandFor("yarn", { yarnMajor: 4 })).toContain("--immutable")
    // Berry has no `--ignore-scripts` on install; it is `enableScripts: false`
    // in .yarnrc.yml. Passing the v1 flag there is an immediate usage error.
    expect(installCommandFor("yarn", { yarnMajor: 4 })).not.toContain("--ignore-scripts")
  })

  it("enables corepack for exactly the managers corepack manages", () => {
    expect(needsCorepack("pnpm")).toBe(true)
    expect(needsCorepack("yarn")).toBe(true)
    expect(needsCorepack("npm")).toBe(false)
    // Corepack does not know bun, so the block copies the binary instead.
    expect(needsCorepack("bun")).toBe(false)
    expect(renderPackageManagerBlock("bun")).toContain("COPY --from=oven/bun:1")
  })

  it("never changes the runtime base image", () => {
    // Bun is copied in as a tool. A `FROM oven/bun` would make it the runtime,
    // which is a fixed architecture decision this renderer does not get to make.
    for (const manager of MANAGERS) {
      expect(renderPackageManagerBlock(manager)).not.toMatch(/^FROM /m)
    }
  })
})

describe("the packageManager field", () => {
  function projectWith(manager: string, version: string | null) {
    const dir = mkdtempSync(join(tmpdir(), "flowcms-pm-"))
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-site" }, null, 2))
      writePackageManagerFields(dir, {
        packageManager: manager,
        packageManagerVersion: version,
      })
      return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it.each(["npm", "pnpm", "yarn"])("is written for %s when the version was observed", (manager) => {
    expect(projectWith(manager, "1.2.3").packageManager).toBe(`${manager}@1.2.3`)
  })

  it("is omitted when the version could not be observed", () => {
    // Corepack refuses to run a version that does not exist, so an invented one
    // turns every command in the project into an error.
    expect(projectWith("pnpm", null).packageManager).toBeUndefined()
  })

  /**
   * THE DEFECT THIS EXISTS FOR: the field is read by corepack, and corepack
   * manages three package managers. `bun@1.3.14` in it does not make corepack
   * ignore the project — it makes every corepack shim in it fail with
   * `Unsupported package manager "bun"`, which is npm, pnpm and yarn on any
   * machine where `corepack enable` was ever run for some other project. Bun
   * does not read the field, so writing it buys nothing.
   */
  it("is omitted for bun, which corepack does not manage", () => {
    expect(projectWith("bun", "1.3.14").packageManager).toBeUndefined()
  })
})

/**
 * pnpm's build approval (Phase 8.6).
 *
 * pnpm 10+ will not run a dependency's install scripts unless told to, and
 * FAILS the install rather than skipping them — so without this file the first
 * thing a pnpm operator meets is `ERR_PNPM_IGNORED_BUILDS` on a project they
 * have not touched yet. Phase 8 final verification hit exactly that.
 */
describe("pnpm build approval", () => {
  function settingsFor(manager: string): string | null {
    const dir = mkdtempSync(join(tmpdir(), "flowcms-pnpmset-"))
    try {
      writePnpmSettings(dir, { packageManager: manager })
      const path = join(dir, "pnpm-workspace.yaml")
      try {
        return readFileSync(path, "utf8")
      } catch {
        return null
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it("uses allowBuilds, not the pnpm 9/10 onlyBuiltDependencies", () => {
    // The setting was renamed AND reshaped: a list called
    // `onlyBuiltDependencies` became a map called `allowBuilds`. Phase 8 tried
    // the old name in both package.json and this file; neither suppressed the
    // error, because the NAME was wrong rather than the location.
    const body = settingsFor("pnpm") ?? ""
    expect(body).toMatch(/^allowBuilds:/m)
    expect(body).not.toMatch(/onlyBuiltDependencies/)
  })

  it("approves exactly the two packages that need a native build", () => {
    const body = settingsFor("pnpm") ?? ""
    expect(body).toMatch(/^ {2}sharp: true$/m)
    expect(body).toMatch(/^ {2}unrs-resolver: true$/m)
  })

  it("stays an allowlist — no blanket approval of every dependency", () => {
    // A project that runs every dependency's install scripts has handed an
    // arbitrary transitive package a shell on the operator's machine.
    const body = settingsFor("pnpm") ?? ""
    const approvals = [...body.matchAll(/^ {2}(\S+): true$/gm)].map((m) => m[1])
    expect(approvals.sort()).toEqual(["sharp", "unrs-resolver"])
    expect(body).not.toMatch(/dangerouslyAllowAllBuilds|neverBuiltDependencies|\*: true/)
  })

  it.each(["npm", "yarn", "bun"])("writes nothing for %s", (manager) => {
    // Inert for the other three, and this project does not write fields that
    // buy nothing — the same rule that keeps `packageManager` off bun.
    expect(settingsFor(manager)).toBeNull()
  })
})

describe("invocation through a package manager", () => {
  /**
   * `npm create flowcms@latest my-site -- --database sqlite` is the documented
   * form, and the separator does not always get eaten on the way through. A CLI
   * that refuses it is one whose documented command is a usage error under one
   * of the four managers, with nothing to tell the operator which.
   */
  it("accepts a `--` separator forwarded by the invoking manager", () => {
    const options = parseArgs(["--", "my-site", "--database", "sqlite"])
    expect(options.directory).toBe("my-site")
    expect(options.database).toBe("sqlite")
  })

  it("still refuses a misspelled flag", () => {
    expect(() => parseArgs(["my-site", "--databse", "sqlite"])).toThrow(/Unknown option/)
  })

  it("still takes exactly one project directory", () => {
    expect(() => parseArgs(["--", "one", "two"])).toThrow(/one project directory/)
  })
})

describe("spawning a package manager", () => {
  it("passes arguments as an array, never as a command line", () => {
    for (const manager of MANAGERS) {
      const { command, args } = getInstallCommand(manager)
      expect(command).toBe(manager)
      expect(Array.isArray(args)).toBe(true)
      expect(args).toEqual(["install"])
    }
  })

  it("guesses no executable extension", () => {
    // It used to append `.cmd` on Windows, which was wrong for bun (a real
    // .exe) and useless for the other three (spawn refuses a .cmd without a
    // shell regardless). Extension resolution belongs to whatever launches the
    // process — and the module says so at length, which is why the commentary
    // is stripped before the code is read.
    const source = codeOnly(
      readFileSync(
        join(process.cwd(), "packages", "create-flowcms", "src", "packageManager.mjs"),
        "utf8",
      ),
    )
    expect(source).not.toMatch(/["'`]\.cmd["'`]/)
    expect(source).not.toMatch(/["'`]\.exe["'`]/)
    // The one executable named on purpose is the Windows interpreter, and it is
    // reached through COMSPEC first rather than hardcoded outright.
    expect(source).toContain("process.env.COMSPEC")
  })

  it("never asks for a shell", () => {
    const source = codeOnly(
      readFileSync(
        join(process.cwd(), "packages", "create-flowcms", "src", "packageManager.mjs"),
        "utf8",
      ),
    )
    // `shell: true` routes every character of an operator's path through a
    // parser. The Windows path names cmd.exe explicitly instead, with a fixed
    // argument list built from this module's own tables.
    expect(source).not.toMatch(/shell:\s*true/)
    expect(source).toMatch(/shell:\s*false/)
  })
})

describe("cross-platform filesystem assumptions", () => {
  const SOURCES = [
    "args.mjs",
    "cli.mjs",
    "destination.mjs",
    "packageManager.mjs",
    "projectName.mjs",
    "scaffold.mjs",
    "secrets.mjs",
    "config/adminPath.mjs",
    "config/database.mjs",
    "config/model.mjs",
    "config/redis.mjs",
    "config/resolve.mjs",
    "config/secrets.mjs",
    "config/storage.mjs",
    "config/validate.mjs",
    "prompts/interactive.mjs",
    "render/compose.mjs",
    "render/dockerfile.mjs",
    "render/env.mjs",
    "render/envFile.mjs",
    "render/marker.mjs",
    "render/project.mjs",
    "render/readme.mjs",
  ]

  function cliSource(file: string) {
    return codeOnly(
      readFileSync(
        join(process.cwd(), "packages", "create-flowcms", "src", ...file.split("/")),
        "utf8",
      ),
    )
  }

  it("joins filesystem paths with node:path, in every module that touches one", () => {
    // A Windows separator is never assumed and a POSIX one is never hardcoded,
    // because no module builds a path itself.
    for (const file of SOURCES) {
      const source = cliSource(file)
      if (!/\bnode:fs\b/.test(source)) continue
      expect(source, `${file} touches the filesystem without node:path`).toMatch(
        /from "node:path"/,
      )
    }
  })

  it("writes a temporary file nowhere but os.tmpdir()", () => {
    for (const file of SOURCES) {
      expect(cliSource(file)).not.toMatch(/["'`]\/tmp\//)
    }
  })

  it("treats a chmod as best effort rather than as a requirement", () => {
    // A POSIX mode is a no-op on Windows. Failing project creation over a
    // permission bit trades a real outcome for a cosmetic one — but the call
    // still has to be made, because on a shared Linux box `.env` holding
    // AUTH_SECRET being world-readable is not cosmetic at all.
    const source = cliSource("render/project.mjs")
    expect(source).toContain("chmodSync(path, 0o600)")
    expect(source).toMatch(/try\s*\{[\s\S]*chmodSync[\s\S]*\}\s*catch/)
  })

  it("detects a filesystem root without naming one", () => {
    const source = cliSource("destination.mjs")
    // `parse(target).root === target` covers "/" and "C:\" with no branch.
    expect(source).toContain("parse(target).root === target")
    expect(source).not.toMatch(/===\s*["'`]\/["'`]/)
  })
})

describe("line endings, which decide whether a container starts", () => {
  /**
   * A CRLF shebang makes the kernel look for the interpreter `/bin/sh\r`, and
   * the container exits reporting that a path which obviously exists does not.
   * Git for Windows defaults to `core.autocrlf=true`, and `create-flowcms`
   * copies the template byte for byte — so whatever a contributor has on disk
   * is what every generated project gets.
   */
  it("pins LF for everything a kernel or an image build executes", () => {
    const attributes = repoFile(".gitattributes")
    for (const pattern of ["*.sh", "*.mjs", "Dockerfile", "*.sql"]) {
      expect(attributes).toMatch(new RegExp(`^${pattern.replace("*", "\\*")}\\s+.*eol=lf`, "m"))
    }
  })

  it("keeps the entrypoint free of carriage returns on disk", () => {
    expect(readFileSync(join(process.cwd(), "docker", "entrypoint.sh"), "utf8")).not.toContain("\r")
  })

  it("does not normalise binaries", () => {
    const attributes = repoFile(".gitattributes")
    for (const pattern of ["*.png", "*.woff2", "*.ico"]) {
      expect(attributes).toMatch(new RegExp(`^${pattern.replace("*", "\\*")}\\s+binary`, "m"))
    }
  })
})

describe("a temporary directory, wherever the OS puts it", () => {
  it("is usable for the destination checks", () => {
    // Not a portability proof so much as a guard against a test in this suite
    // ever hardcoding /tmp: os.tmpdir() is C:\Users\…\Temp on Windows.
    const dir = mkdtempSync(join(tmpdir(), "flowcms-tmp-"))
    try {
      mkdirSync(join(dir, "nested"))
      expect(dir.startsWith(tmpdir())).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
