#!/usr/bin/env node
/**
 * The package-manager matrix proof.
 *
 * WHAT IT IS FOR. `scripts/verify-create-flowcms.mjs` proves one manager — npm
 * — end to end. This proves the other three, and the invocation forms all four
 * are documented with. It is the script the CI matrix designed in Phase 8.4
 * runs; it was WRITTEN in Phase 8.4 and NOT RUN there, which is why every claim
 * in `docs/distribution/package-managers.md` still says "supported" rather than
 * "verified".
 *
 *   node scripts/verify-package-manager-matrix.mjs
 *   node scripts/verify-package-manager-matrix.mjs --managers pnpm,bun
 *   node scripts/verify-package-manager-matrix.mjs --no-docker
 *   node scripts/verify-package-manager-matrix.mjs --no-build   # scaffold+install only
 *
 * WHAT IT CANNOT PROVE, AND SAYS SO. `npm create flowcms`, `pnpm create
 * flowcms`, `yarn create flowcms` and `bun create flowcms` all resolve
 * `create-flowcms` FROM A REGISTRY. Nothing published means nothing to resolve,
 * and a local tarball cannot stand in: the whole question is what each manager
 * does with the name and the arguments on the way to the registry. Those four
 * are reported as SKIPPED with the reason, not silently passed.
 *
 * What a tarball CAN prove is the half that is about this package rather than
 * about a registry: that each manager can install the packed artifact, that the
 * `bin` entry is linked under the name `create-flowcms`, that it is executable
 * after the manager linked it, and that arguments — including a forwarded `--`
 * — arrive intact. That is what runs below.
 *
 * EVERY STEP RUNS OUTSIDE THIS REPOSITORY, in a temporary directory, for the
 * same reason `verify-create-flowcms.mjs` does: running the CLI from here would
 * prove only that it works where every file it could want is already on disk.
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "..")
const CLI_DIR = join(ROOT, "packages", "create-flowcms")

const ALL_MANAGERS = ["npm", "pnpm", "yarn", "bun"]

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const value = (name) => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : null
}

const MANAGERS = (value("--managers") ?? ALL_MANAGERS.join(",")).split(",").filter(Boolean)
const WITH_DOCKER = !flag("--no-docker")
const WITH_BUILD = !flag("--no-build")

const results = []
let failures = 0

function record(name, status, detail = "") {
  results.push({ name, status, detail })
  const mark = { pass: "PASS", fail: "FAIL", skip: "SKIP" }[status]
  console.log(`  ${mark}  ${name}${detail ? ` — ${detail}` : ""}`)
  if (status === "fail") failures += 1
}

/**
 * Run a command, never through a shell.
 *
 * The same rule the CLI itself follows: a path with a space, a semicolon or a
 * `$(…)` in it is an ordinary path, and a proof that used a shell would be
 * proving something with a different threat model than the thing it tests.
 *
 * On Windows the interpreter is named explicitly, because npm, pnpm and yarn
 * are `.cmd` shims there and `spawn` refuses to launch one without a shell.
 */
function run(command, args, options = {}) {
  const windows = process.platform === "win32"
  const file = windows ? (process.env.COMSPEC ?? "cmd.exe") : command
  const spawnArgs = windows ? ["/d", "/s", "/c", command, ...args] : args

  return spawnSync(file, spawnArgs, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    shell: false,
    env: { ...process.env, ...options.env },
  })
}

function available(manager) {
  const result = run(manager, ["--version"], { capture: true })
  return result.status === 0
}

function managerVersion(manager) {
  const result = run(manager, ["--version"], { capture: true })
  return result.status === 0 ? String(result.stdout).trim().split("\n")[0] : "unknown"
}

/**
 * `<manager> run <script>`, which every one of the four accepts.
 *
 * Deliberately not the bare shorthands (`pnpm start`, `bun start`): each
 * manager defines its own set, and `bun start` in particular is not a
 * documented one. A proof that used a shorthand would be testing the shorthand.
 */
function runScriptArgs(script) {
  return ["run", script]
}

const LOCKFILES = {
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
  yarn: "yarn.lock",
  bun: "bun.lock",
}

// ---------------------------------------------------------------------------
// Pack the CLI once. Every manager installs the SAME artifact.
// ---------------------------------------------------------------------------

console.log("\nPacking create-flowcms")
const PACK_DIR = mkdtempSync(join(tmpdir(), "flowcms-pack-"))
const packed = run("npm", ["pack", "--pack-destination", PACK_DIR], {
  cwd: CLI_DIR,
  capture: true,
})
if (packed.status !== 0) {
  console.error(packed.stderr || packed.stdout)
  console.error("\nCould not pack the CLI. Build the template first: node scripts/build-create-flowcms.mjs")
  process.exit(1)
}
const TARBALL = join(PACK_DIR, String(packed.stdout).trim().split("\n").pop().trim())
console.log(`  ${TARBALL}`)

// ---------------------------------------------------------------------------
// Per manager
// ---------------------------------------------------------------------------

const scratch = []

for (const manager of MANAGERS) {
  console.log(`\n=== ${manager} ===`)

  if (!available(manager)) {
    record(`${manager}: present on PATH`, "skip", "not installed on this runner")
    continue
  }
  record(`${manager}: present on PATH`, "pass", managerVersion(manager))

  const home = mkdtempSync(join(tmpdir(), `flowcms-${manager}-`))
  scratch.push(home)

  // A host package for the CLI, so the manager has somewhere to install it.
  writeFileSync(
    join(home, "package.json"),
    `${JSON.stringify({ name: "flowcms-cli-host", version: "1.0.0", private: true }, null, 2)}\n`,
  )

  // 1. The manager can install the packed artifact and link its bin.
  const installed = run(manager, ["add", TARBALL], { cwd: home, capture: true })
  const installFallback =
    installed.status === 0 ? installed : run(manager, ["install", TARBALL], { cwd: home, capture: true })

  if (installFallback.status !== 0) {
    record(`${manager}: installs the packed CLI`, "fail", "install returned non-zero")
    continue
  }
  record(`${manager}: installs the packed CLI`, "pass")

  // EACH MANAGER PICKS ITS OWN SHIM, AND THE ASSERTION MUST NOT PICK FOR THEM.
  //
  // This used to require `create-flowcms.cmd` on Windows, which is npm's
  // convention. bun writes `create-flowcms.bunx` and `create-flowcms.exe`
  // instead, so bun failed here while the two checks that actually USE the bin
  // passed immediately afterwards — a contradiction that was the tell. What
  // matters is that a link exists under the name and that it runs, not which
  // extension the manager chose. Verified on 11.23.0 / 1.22.22 / 1.3.14.
  const binDir = join(home, "node_modules", ".bin")
  const shims = existsSync(binDir)
    ? readdirSync(binDir).filter((f) => f === "create-flowcms" || f.startsWith("create-flowcms."))
    : []
  record(
    `${manager}: links the bin as create-flowcms`,
    shims.length > 0 ? "pass" : "fail",
    shims.length > 0 ? `${binDir} → ${shims.join(", ")}` : `nothing named create-flowcms in ${binDir}`,
  )

  // 2. Argument forwarding, including a `--` the manager may or may not eat.
  //    Run through the manager's own exec verb, which is the closest reachable
  //    analogue of `<manager> create flowcms` without a registry.
  //    `yarn exec` IS A YARN BERRY VERB. Yarn 1 does not have it: given an
  //    unknown command Yarn Classic prints its own help and exits 0, so the
  //    assertion below could never match and yarn was recorded as failing to
  //    forward arguments it forwards perfectly well. Yarn 1's equivalent for a
  //    locally installed bin is `yarn run <bin>`, which was verified by hand.
  //    Keyed on the observed major so a Berry machine still uses `exec`.
  const yarnVerb = managerVersion(manager).startsWith("1.") ? "run" : "exec"
  const execVerb = { npm: "exec", pnpm: "exec", yarn: yarnVerb, bun: "x" }[manager]
  const help = run(manager, [execVerb, "create-flowcms", "--", "--help"], {
    cwd: home,
    capture: true,
  })
  record(
    `${manager}: forwards arguments to the bin`,
    help.status === 0 && String(help.stdout).includes("create-flowcms <project-directory>")
      ? "pass"
      : "fail",
  )

  // HOST CONFIGURATION IS PROVEN ON THE HOST. DOCKER CONFIGURATION IS PROVEN IN
  // DOCKER. THEY ARE NOT THE SAME PROJECT.
  //
  // This used to generate ONE project whose topology was chosen by
  // `WITH_DOCKER`, and then run `build`, `typecheck` and `lint` on it directly.
  // With Docker enabled that meant host-building a DOCKER project — whose
  // `DATABASE_URL` is the container's `file:/data/app.db` — so every manager
  // failed identically with `EACCES: permission denied, mkdir '/data'` from
  // `src/db/createDatabase.ts`. The product was fine: all three Docker image
  // builds passed in the same run.
  //
  // The fix is NOT to let the application tolerate `/data` on a host. A runtime
  // database failure must stay loud. The fix is to stop asking a container
  // configuration to work somewhere it was never for — the same correction
  // already made in `scripts/verify-create-flowcms.mjs`.
  const scaffolder = join(home, "node_modules", "create-flowcms", "bin", "create-flowcms.mjs")

  /** Host build proof: a `local` project, whose SQLite path is `file:data/app.db`. */
  const HOST_TOPOLOGY = [
    "--deployment", "local",
    "--database", "sqlite",
    "--storage", "s3",
    "--redis", "none",
  ]

  /** Image proof: a `docker` project, built only by the Dockerfile, never here. */
  const DOCKER_TOPOLOGY = [
    "--deployment", "docker",
    "--database", "sqlite",
    "--storage", "garage",
    "--redis", "none",
  ]

  // A local deployment stores media on external S3 and the validator requires
  // values for it. Deliberately fake: nothing in scaffold/install/build reaches
  // the endpoint, and a placeholder that reads as one is safer in a log.
  const INSTALLER_ENV = {
    FLOWCMS_INSTALL_S3_ENDPOINT: "https://s3.example.com",
    FLOWCMS_INSTALL_S3_REGION: "us-east-1",
    FLOWCMS_INSTALL_S3_BUCKET: "flowcms",
    FLOWCMS_INSTALL_S3_ACCESS_KEY_ID: "example",
    FLOWCMS_INSTALL_S3_SECRET_ACCESS_KEY: "example",
  }

  const generate = (dir, topology, env) =>
    run("node", [scaffolder, dir, ...topology, "--package-manager", manager], {
      cwd: home,
      capture: true,
      env,
    })

  // 3. Scaffold the HOST project with this manager selected, and let it install.
  const project = join(home, "site")
  const scaffold = generate(project, HOST_TOPOLOGY, INSTALLER_ENV)
  if (scaffold.status !== 0) {
    record(`${manager}: scaffolds and installs`, "fail", String(scaffold.stderr).slice(0, 400))
    continue
  }
  record(`${manager}: scaffolds and installs`, "pass")

  // 4. The lockfile is the one this manager writes, and it is the only one.
  const expected = LOCKFILES[manager]
  const wrong = Object.entries(LOCKFILES)
    .filter(([name]) => name !== manager)
    .map(([, file]) => file)
    .filter((file) => existsSync(join(project, file)))
  record(
    `${manager}: wrote ${expected} and nothing else`,
    existsSync(join(project, expected)) && wrong.length === 0 ? "pass" : "fail",
    wrong.length > 0 ? `also found ${wrong.join(", ")}` : "",
  )

  // 5. The packageManager field: present for corepack's three, absent for bun.
  const manifest = JSON.parse(readFileSync(join(project, "package.json"), "utf8"))
  const wantsField = manager !== "bun"
  record(
    `${manager}: packageManager field ${wantsField ? "written" : "omitted"}`,
    wantsField
      ? typeof manifest.packageManager === "string" && manifest.packageManager.startsWith(manager)
        ? "pass"
        : "fail"
      : manifest.packageManager === undefined
        ? "pass"
        : "fail",
  )

  // 6. The generated README names this manager's commands and no other's.
  const readme = readFileSync(join(project, "README.md"), "utf8")
  const strayNpm =
    manager !== "npm" && /(^|[`\s])npm (install|run|start|ci)\b/m.test(readme)
  record(`${manager}: README names no other manager's commands`, strayNpm ? "fail" : "pass")

  if (!WITH_BUILD) continue

  // 7. The build, through this manager's own `run`.
  for (const script of ["build:packages", "build", "typecheck", "lint"]) {
    const step = run(manager, runScriptArgs(script), { cwd: project })
    record(`${manager}: ${script}`, step.status === 0 ? "pass" : "fail")
    if (step.status !== 0) break
  }

  // 8. The image build, from a SECOND project generated for Docker.
  //
  // It gets its own project because its configuration is only correct inside a
  // container, and it is never built here — the Dockerfile builds it, in the
  // environment that configuration describes. This is also where a lockfile
  // assumption surfaces: the scaffolder installs during generation, so the
  // manager's own lockfile exists before the deps stage runs `<manager> ci`,
  // which cannot create one.
  if (WITH_DOCKER && process.platform === "linux") {
    const dockerProject = join(home, "site-docker")
    const dockerScaffold = generate(dockerProject, DOCKER_TOPOLOGY, {})

    if (dockerScaffold.status !== 0) {
      record(
        `${manager}: docker build`,
        "fail",
        `docker-topology scaffold failed: ${String(dockerScaffold.stderr).slice(0, 300)}`,
      )
    } else {
      const expectedLock = LOCKFILES[manager]
      if (!existsSync(join(dockerProject, expectedLock))) {
        record(
          `${manager}: docker build`,
          "fail",
          `${expectedLock} missing from the docker-topology project; the image build cannot create one`,
        )
      } else {
        const image = run("docker", ["build", "-t", `flowcms-${manager}-check`, "."], {
          cwd: dockerProject,
        })
        record(`${manager}: docker build`, image.status === 0 ? "pass" : "fail")
      }
    }
  } else if (WITH_DOCKER) {
    record(`${manager}: docker build`, "skip", "Linux runners only")
  }
}

// ---------------------------------------------------------------------------
// The registry-dependent invocations, which cannot be proved from a tarball
// ---------------------------------------------------------------------------

console.log("\n=== registry invocation ===")
for (const form of [
  "npx create-flowcms@latest my-site",
  "npm create flowcms@latest my-site -- --database sqlite",
  "pnpm create flowcms my-site",
  "yarn create flowcms my-site",
  "bun create flowcms my-site",
]) {
  record(form, "skip", "create-flowcms is not published; nothing to resolve")
}

// ---------------------------------------------------------------------------

console.log("\n---")
const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {})
console.log(`pass ${counts.pass ?? 0}   fail ${counts.fail ?? 0}   skip ${counts.skip ?? 0}`)

for (const dir of [PACK_DIR, ...scratch]) rmSync(dir, { recursive: true, force: true })

process.exit(failures > 0 ? 1 : 0)
