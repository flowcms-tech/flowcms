#!/usr/bin/env node
/**
 * THE CLEAN APPLICATION PROOF.
 *
 * Phase 7.2 proved a clean THEME consumer: a packed `flowcms` installed into a
 * temp directory and compiled against. This proves the other half — a clean
 * APPLICATION consumer:
 *
 *     build the template  →  npm pack create-flowcms  →  copy the tarball
 *     somewhere unrelated →  run its actual bin       →  generate a project
 *     OUTSIDE this repository → install → build → typecheck → lint → Docker
 *
 * WHY THE TARBALL, AND WHY OUTSIDE
 *
 * Running `node packages/create-flowcms/src/index.mjs` from the repository
 * proves the code works where every file it could possibly want is already on
 * disk. It cannot catch the failures that matter: a `files` allowlist that
 * forgot the template, a path resolved from `process.cwd()`, a `.gitignore` npm
 * renamed on the way into the tarball, a generated project that only builds
 * because the repository's `node_modules` was one directory up.
 *
 * Every one of those works perfectly here and fails for the first stranger.
 *
 * Usage:
 *   node scripts/verify-create-flowcms.mjs            full proof
 *   node scripts/verify-create-flowcms.mjs --no-docker  skip the image build
 *   node scripts/verify-create-flowcms.mjs --keep       leave the workspace
 */

import { execFileSync } from "node:child_process"
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  rmSync,
  readFileSync,
  existsSync,
  readdirSync,
  lstatSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { join, dirname, relative, sep, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const KEEP = process.argv.includes("--keep")
const NO_DOCKER = process.argv.includes("--no-docker")

const failures = []

function step(title) {
  console.log(`\n=== ${title} ===`)
}

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok    ${label}`)
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`)
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`)
  }
}

/**
 * The captured output of a failed child process, HEAD FIRST.
 *
 * This used to be `.slice(-600)` — the last 600 characters. That is the wrong
 * end. A Node fatal error prints its cause on the FIRST line and then hundreds
 * of stack frames, so keeping the tail preserved the frames and discarded the
 * only line that says what happened: a macOS build failure in CI reported two
 * hundred `node::` addresses and nothing else, and could not be diagnosed at
 * all from the log it produced.
 *
 * Keep both ends. The head carries the error, the tail carries whatever the
 * process was doing when it died, and the middle of a stack dump is noise.
 */
function captured(error, budget = 1200) {
  // `error.message` first: for execFileSync it is the "Command failed: …" line,
  // which names WHICH command died before any of its output is quoted.
  const text = [error.message, String(error.stdout ?? ""), String(error.stderr ?? "")]
    .filter(Boolean)
    .join("\n")
    .trim()
  if (text.length <= budget) return text

  const half = Math.floor(budget / 2)
  return `${text.slice(0, half)}\n  … ${text.length - budget} characters elided …\n${text.slice(-half)}`
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...options })
const npmRun = (args, cwd, options = {}) =>
  run(npm, args, { cwd, shell: process.platform === "win32", ...options })

/**
 * The heap ceiling for the generated project's build and typecheck, as an
 * ENVIRONMENT variable rather than a command-line flag.
 *
 * The same reason the Dockerfile sets `ENV NODE_OPTIONS` (Phase 8.8): Next forks
 * a separate worker for the type-check phase, and a fork inherits the
 * environment, not the parent's argv. `--max-old-space-size` on the `build`
 * script therefore never reaches the process that needs it, and `tsc --noEmit`
 * gets no ceiling at all.
 *
 * That is what killed this proof on macos-14, where V8's default heap is
 * smaller than on the Linux and Windows runners: both commands died in
 * `node::OOMErrorHandler`. It is a property of the machine, not of the platform,
 * so nothing here branches on `process.platform` — a low-memory Linux box would
 * fail the same way, and now gets the same headroom.
 */
const BUILD_ENV = {
  ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=4096`.trim(),
}
const node = (args, cwd, options = {}) => run(process.execPath, args, { cwd, ...options })

function walk(dir, base = dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return lstatSync(full).isDirectory() && !lstatSync(full).isSymbolicLink()
      ? walk(full, base)
      : [relative(base, full).split(sep).join("/")]
  })
}

// ---------------------------------------------------------------------------
// 1. Build and pack
// ---------------------------------------------------------------------------

step("Build the application template")
console.log(node([join(ROOT, "scripts", "build-create-flowcms.mjs")], ROOT).trim())

const WORK = mkdtempSync(join(tmpdir(), "flowcms-scaffold-"))
const TARBALLS = join(WORK, "tarballs")
const PROJECTS = join(WORK, "projects")
mkdirSync(TARBALLS, { recursive: true })
mkdirSync(PROJECTS, { recursive: true })
console.log(`workspace: ${WORK}`)

step("npm pack create-flowcms")
const packOut = npmRun(["pack", "--pack-destination", TARBALLS, "--silent"], join(ROOT, "packages", "create-flowcms"))
const tarballName = packOut.trim().split("\n").pop().trim()
const tarball = join(TARBALLS, tarballName)
console.log(`  ${tarballName}`)

const dryRun = JSON.parse(
  npmRun(["pack", "--dry-run", "--json"], join(ROOT, "packages", "create-flowcms")),
)[0]
const packedFiles = dryRun.files.map((f) => f.path)
console.log(`  ${packedFiles.length} files, ${(dryRun.size / 1024 / 1024).toFixed(2)} MB packed, ${(dryRun.unpackedSize / 1024 / 1024).toFixed(2)} MB unpacked`)

// ---------------------------------------------------------------------------
// 2. Audit the tarball
// ---------------------------------------------------------------------------

step("Tarball contents")

const FORBIDDEN = [
  [/(^|\/)\.env$/, "a real environment file"],
  [/(^|\/)\.env\.(?!example)/, "a non-example environment file"],
  [/data-info/, "the local credentials scratch file"],
  [/\.db($|-)/, "a database"],
  [/\.sqlite/, "a database"],
  [/(^|\/)node_modules\//, "installed dependencies"],
  [/(^|\/)\.git\//, "repository history"],
  [/(^|\/)\.claude\//, "local agent tooling"],
  [/(^|\/)\.next\//, "build output"],
  [/superpowers/, "internal planning documents"],
  [/flowcms-theme-aurora/, "the example theme fixture"],
  [/\.tgz$/, "a nested package tarball"],
  [/(^|\/)coverage\//, "coverage output"],
  [/\.pem$|\.key$/, "a private key"],
  [/publish-guard/, "the publish guard, which is repository tooling"],
  [/^tests?\//, "the repository test suite"],
]
for (const [pattern, why] of FORBIDDEN) {
  const bad = packedFiles.filter((f) => pattern.test(f))
  check(`no ${why} in the tarball`, bad.length === 0, bad.slice(0, 4).join(", "))
}

const ALLOWED_TOP = /^(bin\/|src\/|template\/|template\.json$|package\.json$|README\.md$)/
const strays = packedFiles.filter((f) => !ALLOWED_TOP.test(f))
check("tarball contains only allowlisted paths", strays.length === 0, strays.slice(0, 5).join(", "))

// The npm trap this project would otherwise hit silently.
check(
  "the template's ignore file survived packing under its neutral name",
  packedFiles.includes("template/gitignore"),
)
check(
  "npm did not rewrite it into an .npmignore",
  !packedFiles.includes("template/.npmignore") && !packedFiles.includes("template/.gitignore"),
)
check("the template's .env.example survived packing", packedFiles.includes("template/.env.example"))
check("the bin is in the tarball", packedFiles.includes("bin/create-flowcms.mjs"))
check(
  "a generous size ceiling holds (nothing enormous slipped in)",
  dryRun.unpackedSize < 25 * 1024 * 1024,
  `${(dryRun.unpackedSize / 1024 / 1024).toFixed(2)} MB unpacked`,
)

// ---------------------------------------------------------------------------
// 3. Install the packed CLI somewhere unrelated, and run its bin
// ---------------------------------------------------------------------------

step("Install the packed CLI outside the repository")
const CLI_HOME = join(WORK, "cli-home")
mkdirSync(CLI_HOME, { recursive: true })
writeFileSync(
  join(CLI_HOME, "package.json"),
  JSON.stringify({ name: "cli-host", version: "1.0.0", private: true }, null, 2),
)
// Copied first: the tarball must work from a directory with no relationship to
// the repository that produced it.
const movedTarball = join(CLI_HOME, tarballName)
cpSync(tarball, movedTarball)
npmRun(["install", "--no-audit", "--no-fund", "--no-package-lock", "--ignore-scripts", movedTarball], CLI_HOME)

const installedBin = join(CLI_HOME, "node_modules", "create-flowcms", "bin", "create-flowcms.mjs")
check("the packed CLI installed and exposes its bin", existsSync(installedBin))
check(
  "the installed CLI carries its template",
  existsSync(join(CLI_HOME, "node_modules", "create-flowcms", "template", "package.json")),
)

step("Run the installed bin")
const version = node([installedBin, "--version"], CLI_HOME).trim()
check("--version reports the package version", version === "0.1.0", version)

const help = node([installedBin, "--help"], CLI_HOME)
check("--help documents the usage", help.includes("create-flowcms <project-directory>"))

// Refusals, before anything is written.
for (const [label, args, expected] of [
  ["an unknown flag is refused", ["site", "--nope"], /Unknown option/],
  ["a missing directory is refused", [], /Missing project directory/],
  // Phase 7.4 gave every enum flag one message, so this no longer says
  // "package manager" specifically. What it must still do is name the value it
  // refused and list the ones it accepts — a refusal that does neither leaves
  // an operator guessing at spelling.
  [
    "an unknown package manager is refused",
    ["site", "--package-manager", "cargo"],
    /Unknown value "cargo" for --package-manager.*npm, pnpm, yarn, bun/,
  ],
]) {
  let output = ""
  let code = 0
  try {
    node([installedBin, ...args], PROJECTS)
  } catch (error) {
    code = error.status
    output = String(error.stderr ?? "")
  }
  check(label, code !== 0 && expected.test(output), output.trim().slice(0, 80))
}

// A non-empty destination must fail without touching it.
const occupied = join(PROJECTS, "occupied")
mkdirSync(occupied, { recursive: true })
writeFileSync(join(occupied, "their-work.txt"), "do not delete me")
let refusedCleanly = false
try {
  node([installedBin, occupied], PROJECTS)
} catch (error) {
  refusedCleanly = /not empty/.test(String(error.stderr ?? ""))
}
check("a non-empty destination is refused", refusedCleanly)
check(
  "and is left exactly as it was",
  readdirSync(occupied).join(",") === "their-work.txt" &&
    readFileSync(join(occupied, "their-work.txt"), "utf8") === "do not delete me",
)

// ---------------------------------------------------------------------------
// 4. Generate the project
// ---------------------------------------------------------------------------

step("Generate a project")
const PROJECT = join(PROJECTS, "my-site")

// THE TOPOLOGY MUST MATCH WHERE THIS PROOF ACTUALLY RUNS.
//
// This used to generate a `--deployment docker` project unconditionally and
// then run `npm run build` on the HOST. A Docker-mode project is configured for
// the inside of its container: `DATABASE_URL=file:/data/app.db`, an absolute
// path that belongs to a volume mount. Building it on a runner asked the
// application to use `/data` on the host — EACCES for any non-root user on
// Linux and macOS, and quietly fine on Windows, where `/data` is `C:\data`.
//
// That was a defect in this harness, not in the product: it proved a
// configuration against an environment that configuration was never for. The
// host proof now generates a HOST topology, and the Docker proof at the end of
// this file still generates and builds the Docker one — each configuration is
// exercised where it belongs.
//
// `local` storage defaults to external S3, which the validator requires real
// values for. They are deliberately fake: nothing in install/build/typecheck/
// lint contacts the endpoint, and a placeholder that looks like a placeholder is
// safer in a log than a plausible one.
const hostTopology = [
  "--deployment", "local",
  "--database", "sqlite",
  "--storage", "s3",
  "--redis", "none",
  "--package-manager", "npm",
]
const dockerTopology = [
  "--deployment", "docker",
  "--database", "sqlite",
  "--storage", "garage",
  "--redis", "none",
  "--package-manager", "npm",
]
const TOPOLOGY = hostTopology

const SCAFFOLD_ENV = {
  ...process.env,
  FLOWCMS_INSTALL_S3_ENDPOINT: "https://s3.invalid",
  FLOWCMS_INSTALL_S3_REGION: "us-east-1",
  FLOWCMS_INSTALL_S3_BUCKET: "flowcms-verify",
  FLOWCMS_INSTALL_S3_ACCESS_KEY_ID: "VERIFY-ONLY-NOT-A-CREDENTIAL",
  FLOWCMS_INSTALL_S3_SECRET_ACCESS_KEY: "VERIFY-ONLY-NOT-A-CREDENTIAL-0000",
}

console.log(
  node([installedBin, PROJECT, ...TOPOLOGY, "--skip-install"], PROJECTS, { env: SCAFFOLD_ENV }).trim(),
)
console.log("  topology: local — this project is installed, built, typechecked and linted on the host")

const projectFiles = walk(PROJECT)
check("the project was created", existsSync(join(PROJECT, "package.json")))

/**
 * The project's REAL path, for every containment comparison below.
 *
 * On macOS `/var` is a symlink to `/private/var`, so `realpathSync()` of
 * anything under a temp directory returns `/private/var/folders/…` while
 * `PROJECT` still reads `/var/folders/…`. Three checks compared a realpath'd
 * value against the un-realpath'd prefix and therefore reported "points outside
 * the generated project" about paths that were obviously inside it — a false
 * failure on macOS only, and the reason this job was red while Windows and
 * Linux were green.
 *
 * Both sides have to be resolved the same way. Nothing is loosened: a link that
 * genuinely escapes the project still fails, because its real path will not
 * begin with the project's real path either.
 */
const PROJECT_REAL = realpathSync(PROJECT).split(sep).join("/")
console.log(`  ${projectFiles.length} files`)

const manifest = JSON.parse(readFileSync(join(PROJECT, "package.json"), "utf8"))
check("its package name came from the directory", manifest.name === "my-site", manifest.name)
check("it is private", manifest.private === true)
check("it starts at its own version", manifest.version === "0.1.0", manifest.version)
check("the ignore file arrived as .gitignore", existsSync(join(PROJECT, ".gitignore")))
check("the neutral name was renamed away", !existsSync(join(PROJECT, "gitignore")))
check(
  "it records the template it came from",
  JSON.parse(readFileSync(join(PROJECT, ".flowcms", "project.json"), "utf8")).templateVersion === "0.1.0",
)

// ---------------------------------------------------------------------------
// 5. Independence from this repository
// ---------------------------------------------------------------------------

step("Independence")

const links = []
const scanLinks = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stats = lstatSync(full)
    if (stats.isSymbolicLink()) links.push({ path: relative(PROJECT, full), target: realpathSync(full) })
    else if (stats.isDirectory()) scanLinks(full)
  }
}
scanLinks(PROJECT)
check("the generated project contains no symbolic link", links.length === 0, JSON.stringify(links.slice(0, 3)))

const rootNormalized = ROOT.split(sep).join("/")
const textual = projectFiles.filter((f) => /\.(json|ts|tsx|mjs|js|css|md|yml|yaml|sh)$/.test(f))
const absolutePathLeaks = textual.filter((f) => {
  const source = readFileSync(join(PROJECT, f.split("/").join(sep)), "utf8")
  return source.includes(rootNormalized) || source.includes(ROOT) || /flowcms-codes/.test(source)
})
check(
  "no file mentions the source repository's path",
  absolutePathLeaks.length === 0,
  absolutePathLeaks.slice(0, 3).join(", "),
)

const binaryish = projectFiles.filter((f) => /\.(png|ico|woff2)$/.test(f))
check("binary assets came through", binaryish.length > 0, `${binaryish.length} files`)
for (const asset of binaryish.slice(0, 3)) {
  const generated = readFileSync(join(PROJECT, asset.split("/").join(sep)))
  const original = readFileSync(join(ROOT, "packages", "create-flowcms", "template", asset.split("/").join(sep)))
  check(`  ${asset} is byte-for-byte identical`, Buffer.compare(generated, original) === 0)
}

const entrypoint = join(PROJECT, "docker", "entrypoint.sh")
if (existsSync(entrypoint) && process.platform !== "win32") {
  check("docker/entrypoint.sh kept its executable bit", (lstatSync(entrypoint).mode & 0o111) !== 0)
} else if (existsSync(entrypoint)) {
  // Windows has no executable bit; the Dockerfile chmods it in the image, which
  // is what makes the container work regardless of where it was generated.
  check(
    "docker/entrypoint.sh is chmod'ed by the Dockerfile (Windows has no mode bit)",
    readFileSync(join(PROJECT, "Dockerfile"), "utf8").includes("chmod +x ./docker/entrypoint.sh"),
  )
}

// ---------------------------------------------------------------------------
// 6. Install, build, typecheck, lint
// ---------------------------------------------------------------------------

step("npm install (generated project)")
try {
  npmRun(["install", "--no-audit", "--no-fund"], PROJECT)
  check("dependencies installed", true)
} catch (error) {
  check("dependencies installed", false, captured(error))
}

check("a lockfile was created by the install, not shipped", existsSync(join(PROJECT, "package-lock.json")))

const resolvedFlowcms = existsSync(join(PROJECT, "node_modules", "flowcms"))
check("`flowcms` resolves inside the generated project", resolvedFlowcms)
if (resolvedFlowcms) {
  const real = realpathSync(join(PROJECT, "node_modules", "flowcms")).split(sep).join("/")
  check(
    "and points at the project's OWN packages/flowcms, not this repository",
    real.startsWith(PROJECT_REAL),
    real,
  )
}

step("Every link the install created stays inside the project")
const installedLinks = []
const scanInstalledLinks = (dir, depth = 0) => {
  if (depth > 3) return
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    let stats
    try {
      stats = lstatSync(full)
    } catch {
      continue
    }
    if (stats.isSymbolicLink()) {
      installedLinks.push({ path: relative(PROJECT, full), target: realpathSync(full) })
    } else if (stats.isDirectory() && (entry.startsWith("@") || entry === "node_modules")) {
      scanInstalledLinks(full, depth + 1)
    }
  }
}
if (existsSync(join(PROJECT, "node_modules"))) scanInstalledLinks(join(PROJECT, "node_modules"))
const escaping = installedLinks.filter(
  (link) => !link.target.split(sep).join("/").startsWith(PROJECT_REAL),
)
console.log(`  ${installedLinks.length} link(s) in node_modules`)
check(
  "no installed link points outside the generated project",
  escaping.length === 0,
  JSON.stringify(escaping.slice(0, 3)),
)

step("npm run build:packages (generated project)")
try {
  console.log(npmRun(["run", "build:packages"], PROJECT).trim().split("\n").slice(-2).join("\n"))
  check("the local flowcms package built", existsSync(join(PROJECT, "packages", "flowcms", "dist", "index.js")))
} catch (error) {
  check("the local flowcms package built", false, captured(error))
}

step("flowcms/theme resolves through the real package boundary")
writeFileSync(
  join(PROJECT, "theme-probe.mjs"),
  `import { defineThemeSettings, THEME_SURFACES, cn } from "flowcms/theme"
import { createRequire } from "node:module"
const resolved = createRequire(import.meta.url).resolve("flowcms/theme")
console.log(JSON.stringify({
  resolved,
  surfaces: THEME_SURFACES.length,
  defineIsIdentity: (() => { const d = { version: 1, fields: [] }; return defineThemeSettings(d) === d })(),
  cn: cn("p-2", "p-4"),
}))
`,
)
try {
  const probe = JSON.parse(node([join(PROJECT, "theme-probe.mjs")], PROJECT).trim().split("\n").pop())
  const where = probe.resolved.split(sep).join("/")
  check("`flowcms/theme` imports and executes", probe.surfaces === 8 && probe.defineIsIdentity && probe.cn === "p-4")
  // Node reports the REAL path, and npm installs a `file:` dependency as a
  // link — so this lands on the project's own packages/flowcms/dist rather than
  // on node_modules. That is the correct answer and the meaningful assertion is
  // where it landed: inside the generated project, and nowhere near this
  // repository.
  check("it resolves inside the generated project", where.startsWith(PROJECT_REAL), where)
  check("it does not resolve into the source repository", !where.startsWith(rootNormalized), where)
  check("it resolves to built output, not to TypeScript source", where.endsWith("/dist/index.js"), where)
} catch (error) {
  check("`flowcms/theme` imports and executes", false, String(error.stderr ?? error.message).slice(-400))
}
rmSync(join(PROJECT, "theme-probe.mjs"), { force: true })

const tsconfig = readFileSync(join(PROJECT, "tsconfig.json"), "utf8")
check("no tsconfig alias for flowcms/theme came back", !/"flowcms\/theme"\s*:/.test(tsconfig))

step("npm run build (generated project)")
try {
  npmRun(["run", "build"], PROJECT, { env: BUILD_ENV })
  check("the production build succeeded", existsSync(join(PROJECT, ".next", "BUILD_ID")))
} catch (error) {
  check("the production build succeeded", false, captured(error, 1600))
}

step("npm run typecheck (generated project)")
try {
  npmRun(["run", "typecheck"], PROJECT, { env: BUILD_ENV })
  check("typecheck passed", true)
} catch (error) {
  check("typecheck passed", false, captured(error, 1600))
}

step("npm run lint (generated project)")
try {
  const output = npmRun(["run", "lint"], PROJECT)
  const warnings = output.match(/(\d+) problems? \((\d+) errors?/)
  check("lint ran with no errors", !warnings || warnings[2] === "0", warnings?.[0] ?? "clean")
} catch (error) {
  check("lint ran with no errors", false, captured(error))
}

// ---------------------------------------------------------------------------
// 7. Docker, from the generated directory
// ---------------------------------------------------------------------------

if (!NO_DOCKER) {
  // A SECOND PROJECT, GENERATED FOR DOCKER, AND VERIFIED IN DOCKER.
  //
  // The project above is a host topology because it is installed and built on
  // the host. Docker-mode configuration — the `/data` volume path, the Compose
  // overlays — is only correct inside a container, so it gets its own project
  // and is proved the only way it can honestly be proved: by building the image.
  step("docker build (a Docker-topology project, built as an image)")
  const DOCKER_PROJECT = join(PROJECTS, "my-site-docker")
  node([installedBin, DOCKER_PROJECT, ...dockerTopology, "--skip-install"], PROJECTS, {
    env: SCAFFOLD_ENV,
  })

  // THE IMAGE BUILD NEEDS A LOCKFILE, AND `--skip-install` DOES NOT PRODUCE ONE.
  //
  // The generated Dockerfile's deps stage fails closed on a missing
  // `package-lock.json` — deliberately, because `npm ci` installs exactly what a
  // lockfile pins and cannot invent one. An operator never meets this: the CLI
  // installs dependencies as part of scaffolding, so the lockfile exists before
  // they ever run `docker build`.
  //
  // This proof scaffolds with `--skip-install` to keep the two projects cheap,
  // so it has to do that install itself. Phase 9.7 introduced the second project
  // and missed this, and the verifier reported only "the generated project
  // builds its own image — FAIL" with the Dockerfile's own explanation
  // discarded by a tail-only slice.
  step("npm install (Docker-topology project, for its lockfile)")
  npmRun(["install", "--no-audit", "--no-fund"], DOCKER_PROJECT)
  check(
    "the Docker project has the lockfile its image build requires",
    existsSync(join(DOCKER_PROJECT, "package-lock.json")),
    "package-lock.json is missing; `npm ci --ignore-scripts` in the deps stage cannot run without it",
  )
  try {
    execFileSync("docker", ["build", "-t", "flowcms-generated:probe", "."], {
      cwd: DOCKER_PROJECT,
      encoding: "utf8",
      stdio: "pipe",
      timeout: 20 * 60 * 1000,
    })
    check("the generated project builds its own image", true)
    try {
      execFileSync("docker", ["rmi", "flowcms-generated:probe"], { stdio: "ignore" })
    } catch {
      /* leaving an image behind is not a failure of the proof */
    }
  } catch (error) {
    // `captured()` rather than a tail slice of one stream: a docker build
    // prints the failing RUN's own message near the end but names the step and
    // the stage earlier, and `error.message` carries the exit status. Tail-only
    // reporting is what hid this failure through an entire scheduled run.
    check("the generated project builds its own image", false, captured(error, 2000))
  }
}

// ---------------------------------------------------------------------------

step("Result")
if (!KEEP) rmSync(WORK, { recursive: true, force: true })
else console.log(`  workspace kept at ${WORK}`)

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log("\nclean application proof: PASS")
void resolve
