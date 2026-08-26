#!/usr/bin/env node
/**
 * The release proof: build → test → package → inspect → clean install → create
 * project → release dry-run, in one ordered run.
 *
 *   node scripts/release-proof.mjs                     PLAN — prints, runs nothing
 *   node scripts/release-proof.mjs --execute
 *   node scripts/release-proof.mjs --execute --with-docker
 *   node scripts/release-proof.mjs --execute --only build,test
 *   node scripts/release-proof.mjs --execute --skip database
 *
 * WRITTEN IN PHASE 8.5 AND NEVER EXECUTED. Nothing below has been run, and no
 * claim anywhere in this repository rests on its output.
 *
 * ---------------------------------------------------------------------------
 * It orchestrates. It does not reimplement.
 * ---------------------------------------------------------------------------
 *
 * Every stage shells out to a script that already exists and has already been
 * exercised — `build-package.mjs`, `build-create-flowcms.mjs`,
 * `verify-package-consumer.mjs`, `verify-create-flowcms.mjs`, `db-matrix.sh`.
 * A release proof that reimplemented any of them would be a second
 * implementation of the thing being proved, drifting from the first, and
 * passing for reasons that had nothing to do with the artifact.
 *
 * What this file adds is the parts that genuinely are not covered anywhere:
 * the ORDER, the preconditions, and a tarball hygiene scan across all three
 * package directories.
 *
 * ---------------------------------------------------------------------------
 * Plan mode is the default, on purpose
 * ---------------------------------------------------------------------------
 *
 * A full execution builds packages, builds the template, runs ~1900 tests, runs
 * a production Next build, packs and installs into throwaway directories,
 * scaffolds projects, and — with --with-docker — builds images and starts four
 * database topologies. That is tens of minutes and it writes outside this
 * repository.
 *
 * A tool that does all of that because somebody typed its name to see what it
 * was is a tool people stop typing. So the default prints the plan and exits 0,
 * and running requires saying so.
 *
 * ---------------------------------------------------------------------------
 * It fails closed
 * ---------------------------------------------------------------------------
 *
 * - No stage publishes. The only npm publish here is `--dry-run`, it is opt-in
 *   twice over, and the command is asserted to carry `--dry-run` immediately
 *   before it is spawned.
 * - `--execute` refuses to start if an npm auth token is in the environment.
 *   A proof does not need publish credentials, and a process that has them can
 *   publish by accident.
 * - `--execute` refuses a dirty working tree. A proof of something nobody can
 *   reproduce is not a proof.
 * - Docker stages are opt-in. They start containers and remove volumes.
 * - There is no --force, no --yes and no "continue on failure". A stage that
 *   fails stops the run.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const npm = process.platform === "win32" ? "npm.cmd" : "npm"

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * `run` is either a command tuple or a function. Functions exist only for the
 * checks that have no script of their own; everything else is a tuple, so the
 * plan output is literally what will be executed.
 */
const STAGES = [
  {
    id: "build",
    title: "Build the packages and the application template",
    why: "everything downstream reads packages/flowcms/dist and packages/create-flowcms/template",
    steps: [
      [npm, ["run", "build:packages"]],
      [npm, ["run", "build:template"]],
    ],
  },
  {
    id: "test",
    title: "Unit suite, types, lint, production build",
    why: "the correctness gates. `npm test` rebuilds the packages and the template first, which is intentional duplication of the stage above — it makes `npm test` correct when run alone",
    steps: [
      [npm, ["test"]],
      [npm, ["run", "typecheck"]],
      [npm, ["run", "lint"]],
      [npm, ["run", "build"]],
    ],
  },
  {
    id: "package",
    title: "Pack all three package directories",
    why: "`npm pack --dry-run` runs `prepack`/`prepare` and reports the file list without producing a tarball. Neither publish guard fires on pack, deliberately, so this stage works while publication is blocked",
    steps: [
      [npm, ["pack", "--dry-run", "--json"], { cwd: join(ROOT, "packages", "flowcms") }],
      [npm, ["pack", "--dry-run", "--json"], { cwd: join(ROOT, "packages", "create-flowcms") }],
      [npm, ["pack", "--dry-run", "--json"], { cwd: join(ROOT, "packages", "flowcms-theme-aurora") }],
    ],
  },
  {
    id: "inspect",
    title: "Tarball hygiene scan",
    why: "the `files` allowlists are correct today; this asserts they are still correct after every change. It is the one stage with no existing script, because it is a cross-package question",
    steps: [inspectTarballs],
  },
  {
    id: "consumer",
    title: "Clean-consumer proof for `flowcms`",
    why: "packs both packages, installs the TARBALLS outside this repository, typechecks with strict + skipLibCheck:false, executes every runtime export, renders a surface, and confirms every deep import fails",
    steps: [[process.execPath, [join(ROOT, "scripts", "verify-package-consumer.mjs")]]],
  },
  {
    id: "scaffold",
    title: "Clean-consumer proof for `create-flowcms`",
    why: "packs the CLI, installs it somewhere unrelated to this repository, generates a project outside it, then installs, builds, typechecks and lints that project",
    steps: [[process.execPath, [join(ROOT, "scripts", "verify-create-flowcms.mjs"), "--no-docker"]]],
  },
  {
    id: "scaffold-docker",
    title: "The same, including `docker build` of the generated project",
    why: "the generated Dockerfile is rendered per package manager and is the part most likely to be wrong in a way nothing else notices",
    docker: true,
    steps: [[process.execPath, [join(ROOT, "scripts", "verify-create-flowcms.mjs")]]],
  },
  {
    id: "database",
    title: "Cold start, bootstrap and persistence on all four engines",
    why: "SQLite, PostgreSQL, MySQL and MariaDB. MariaDB is verified separately rather than aliased to MySQL, because it is a different image taking differently-named variables",
    docker: true,
    steps: [
      ["bash", [join(ROOT, "scripts", "db-matrix.sh"), "sqlite"]],
      ["bash", [join(ROOT, "scripts", "db-matrix.sh"), "postgres"]],
      ["bash", [join(ROOT, "scripts", "db-matrix.sh"), "mysql"]],
      ["bash", [join(ROOT, "scripts", "db-matrix.sh"), "mariadb"]],
    ],
  },
  {
    id: "publish-dry-run",
    title: "npm publish --dry-run, in publication order",
    why: "the last thing before the irreversible one. EXPECTED TO FAIL while the release blockers stand: both packages are `private` and both carry a prepublishOnly guard that exits non-zero. That failure is the guards working",
    optIn: "--allow-publish-dry-run",
    steps: [
      [npm, ["publish", "--dry-run", "--access", "public"], { cwd: join(ROOT, "packages", "flowcms") }],
      [npm, ["publish", "--dry-run", "--access", "public"], { cwd: join(ROOT, "packages", "create-flowcms") }],
    ],
  },
]

// ---------------------------------------------------------------------------
// Tarball hygiene
// ---------------------------------------------------------------------------

/**
 * Names that must never appear in any published tarball, at any depth.
 *
 * Not an allowlist — `verify-package-consumer.mjs` already holds the allowlist
 * of top-level entries for `flowcms` and the example theme, and duplicating it
 * would give two lists to keep in step. This is the complementary question,
 * asked across all three packages including `create-flowcms`, whose tarball
 * contains an entire copy of the application and is therefore the one with the
 * most room to go wrong.
 */
const FORBIDDEN = [
  [/(^|\/)\.env$/, "a developer's environment file"],
  [/(^|\/)\.env\.(?!example)/, "an environment file that is not .env.example"],
  [/(^|\/)data-info\.txt$/, "the local credentials scratch file"],
  [/(^|\/)node_modules\//, "installed dependencies"],
  [/(^|\/)\.git\//, "repository history"],
  [/(^|\/)\.claude\//, "agent tooling"],
  [/\.(db|sqlite|sqlite3)$/, "a database file"],
  [/\.(pem|key|p12|pfx)$/, "key material"],
  [/(^|\/)id_rsa/, "an SSH key"],
  [/\.tgz$/, "a packed tarball inside a tarball"],
  [/(^|\/)data\//, "runtime data"],
]

function inspectTarballs(execute) {
  const packages = ["flowcms", "create-flowcms", "flowcms-theme-aurora"]
  if (!execute) {
    console.log("      would run `npm pack --dry-run --json` in each package and scan the")
    console.log(`      reported file list against ${FORBIDDEN.length} forbidden patterns`)
    return true
  }

  let ok = true
  for (const name of packages) {
    const cwd = join(ROOT, "packages", name)
    const result = spawnSync(npm, ["pack", "--dry-run", "--json"], {
      cwd,
      encoding: "utf8",
      shell: false,
    })
    if (result.status !== 0) {
      console.error(`      FAIL  ${name}: npm pack exited ${result.status}`)
      ok = false
      continue
    }
    // npm prints the JSON on stdout and its human summary on stderr.
    let files
    try {
      files = JSON.parse(result.stdout)[0].files.map((f) => f.path)
    } catch {
      console.error(`      FAIL  ${name}: could not parse the pack report`)
      ok = false
      continue
    }
    const hits = []
    for (const path of files) {
      const normalized = path.split("\\").join("/")
      for (const [pattern, why] of FORBIDDEN) {
        if (pattern.test(normalized)) hits.push(`${path} — ${why}`)
      }
    }
    if (hits.length > 0) {
      console.error(`      FAIL  ${name}: ${hits.length} forbidden entries`)
      for (const hit of hits) console.error(`              ${hit}`)
      ok = false
    } else {
      console.log(`      ok    ${name}: ${files.length} files, none forbidden`)
    }
  }
  return ok
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const KNOWN = [
  "--execute",
  "--with-docker",
  "--allow-publish-dry-run",
  "--allow-dirty",
  "--only",
  "--skip",
  "--help",
  "-h",
]

function valueOf(flag) {
  const i = argv.indexOf(flag)
  return i === -1 ? null : argv[i + 1]
}

const ONLY = valueOf("--only")
const SKIP = valueOf("--skip")

for (const arg of argv) {
  if (arg === ONLY || arg === SKIP) continue
  if (!KNOWN.includes(arg)) {
    console.error(`\n[release-proof] Unknown option "${arg}".\n`)
    process.exit(2)
  }
}

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0])
  process.exit(0)
}

const EXECUTE = argv.includes("--execute")
const WITH_DOCKER = argv.includes("--with-docker")
const ALLOW_PUBLISH_DRY_RUN = argv.includes("--allow-publish-dry-run")
const ALLOW_DIRTY = argv.includes("--allow-dirty")

const onlyIds = ONLY ? ONLY.split(",").map((s) => s.trim()) : null
const skipIds = SKIP ? SKIP.split(",").map((s) => s.trim()) : []

for (const id of [...(onlyIds ?? []), ...skipIds]) {
  if (!STAGES.some((s) => s.id === id)) {
    console.error(`\n[release-proof] "${id}" is not a stage. Stages: ${STAGES.map((s) => s.id).join(", ")}\n`)
    process.exit(2)
  }
}

function selected(stage) {
  if (skipIds.includes(stage.id)) return { run: false, reason: "skipped by --skip" }
  if (onlyIds && !onlyIds.includes(stage.id)) return { run: false, reason: "not in --only" }
  if (stage.docker && !WITH_DOCKER) return { run: false, reason: "needs --with-docker" }
  if (stage.optIn && !argv.includes(stage.optIn)) return { run: false, reason: `needs ${stage.optIn}` }
  return { run: true }
}

// ---------------------------------------------------------------------------
// Preconditions — checked only when actually running
// ---------------------------------------------------------------------------

function preconditions() {
  const problems = []

  // A proof does not need publish credentials, and a process holding them can
  // publish by accident — a mistyped stage id, a script edited in a hurry.
  for (const key of Object.keys(process.env)) {
    if (/^(NPM_TOKEN|NODE_AUTH_TOKEN|NPM_CONFIG__AUTH(?:TOKEN)?)$/i.test(key)) {
      problems.push(
        `${key} is set. Unset it: the release proof must never run with publish credentials in scope.`,
      )
    }
  }

  if (!ALLOW_DIRTY) {
    const status = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" })
    if (status.status === 0 && status.stdout.trim() !== "") {
      const count = status.stdout.trim().split("\n").length
      problems.push(
        `The working tree has ${count} uncommitted change(s). A proof of a tree nobody can reproduce is not a proof. Pass --allow-dirty to override during development.`,
      )
    }
  }

  if (!existsSync(join(ROOT, "package.json"))) {
    problems.push("This is not the FlowCMS repository root.")
  }

  return problems
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function describe(step) {
  if (typeof step === "function") return `(${step.name})`
  const [command, args] = step
  return [command, ...args].join(" ")
}

function execute(step) {
  if (typeof step === "function") return step(true)

  const [command, args, options = {}] = step

  // Asserted immediately before spawning rather than trusted from the table
  // above: the table is data somebody will edit, and this is the one command in
  // this repository where being wrong is irreversible.
  if (args[0] === "publish" && !args.includes("--dry-run")) {
    console.error("\n[release-proof] REFUSING: a publish command without --dry-run. This tool never publishes.\n")
    process.exit(1)
  }

  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    stdio: "inherit",
    shell: false, // never a shell: paths here can contain spaces, and this is Windows too
  })
  if (result.error) {
    console.error(`      FAIL  ${result.error.message}`)
    return false
  }
  return result.status === 0
}

console.log(`\nFlowCMS release proof — ${EXECUTE ? "EXECUTING" : "PLAN ONLY, nothing will run"}\n`)

if (EXECUTE) {
  const problems = preconditions()
  if (problems.length > 0) {
    console.error("Refusing to run:\n")
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error("")
    process.exit(1)
  }
}

let ran = 0
for (const stage of STAGES) {
  const { run, reason } = selected(stage)
  console.log(`  [${stage.id}] ${stage.title}`)
  console.log(`      ${stage.why}`)
  if (!run) {
    console.log(`      -- ${reason}\n`)
    continue
  }
  if (!EXECUTE) {
    // Function steps describe themselves in plan mode; command steps are
    // printed exactly as they will be spawned, so the plan is the run.
    for (const step of stage.steps) {
      if (typeof step === "function") step(false)
      else console.log(`      $ ${describe(step)}`)
    }
    console.log("")
    continue
  }
  for (const step of stage.steps) console.log(`      $ ${describe(step)}`)
  console.log("")
  for (const step of stage.steps) {
    if (!execute(step)) {
      console.error(`\n[release-proof] FAILED at stage "${stage.id}".\n`)
      if (stage.id === "publish-dry-run" && !ALLOW_PUBLISH_DRY_RUN) {
        console.error("  (Expected while the publish guards are armed — that failure is the guards working.)\n")
      }
      process.exit(1)
    }
  }
  ran += 1
}

if (!EXECUTE) {
  console.log("Nothing was run. Add --execute to run it.\n")
  console.log("See the maintainer release runbook for the procedure this proof")
  console.log("supports, and for what still stands in the way.\n")
  process.exit(0)
}

console.log(`\n[release-proof] ${ran} stage(s) passed.\n`)
console.log("This proves the ARTIFACTS. It does not clear a single release blocker:")
console.log("the licence, credential rotation, repository metadata, npm name")
console.log("availability and the cross-platform matrix are all human work.")
console.log("See the maintainer release runbook.\n")
