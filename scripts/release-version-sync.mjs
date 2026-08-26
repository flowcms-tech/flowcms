#!/usr/bin/env node
/**
 * The FlowCMS version, in one place, checked or moved.
 *
 *   node scripts/release-version-sync.mjs                  check (the default)
 *   node scripts/release-version-sync.mjs --set 0.2.0       rewrite
 *   node scripts/release-version-sync.mjs --set 0.2.0 --dry-run
 *   node scripts/release-version-sync.mjs --set 0.2.0 --allow-downgrade
 *
 * WRITTEN IN PHASE 8.5 AND NEVER EXECUTED. Nothing here has been run.
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all
 * ---------------------------------------------------------------------------
 *
 * There are three hand-maintained copies of the FlowCMS version and one derived
 * one. Three is already too many to move by hand reliably, and the way they
 * fail is asymmetric: `packages/flowcms/package.json` disagreeing with
 * `FLOWCMS_VERSION` is caught loudly by `scripts/build-package.mjs` and by
 * `tests/packaging/packageArtifact.test.ts`, while `create-flowcms` carrying
 * last release's number is caught by nothing at all and ships a CLI that
 * reports a version it is not.
 *
 * This is forty lines of file editing, not a release platform. Changesets,
 * semantic-release and lerna each solve a problem FlowCMS does not have — many
 * packages on independent cadences — and each brings a configuration file, a
 * changelog generator with opinions, and a dependency in the publish path.
 *
 * ---------------------------------------------------------------------------
 * What it will not do
 * ---------------------------------------------------------------------------
 *
 * - It does not touch `packages/create-flowcms/template.json`. That number is
 *   DERIVED: `scripts/build-create-flowcms.mjs` reads FLOWCMS_VERSION and
 *   writes it. Setting it here would create a second authority for one value,
 *   and the two would disagree the first time somebody ran only one of them.
 *
 * - It does not touch the repository root's `package.json`. `flowcms-app` is
 *   private and never published; nothing resolves its version. Rewriting it
 *   would imply it means something.
 *
 * - It does not commit, tag, push or publish. It edits files and stops. The
 *   release procedure is a maintainer runbook and it is performed by a
 *   person.
 *
 * - It does not move backwards without `--allow-downgrade`. A version going
 *   down is nearly always a typo, and on the one occasion it is not, saying so
 *   costs one flag.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

/** The hand-maintained sources, and how each one stores the number. */
const SOURCES = [
  {
    label: "FLOWCMS_VERSION",
    path: "src/Themes/contract/version.ts",
    read: (text) => text.match(/FLOWCMS_VERSION\s*=\s*"([^"]+)"/)?.[1],
    write: (text, next) =>
      text.replace(/(FLOWCMS_VERSION\s*=\s*")[^"]+(")/, `$1${next}$2`),
    why: "the runtime authority — every theme's flowcmsCompat range is evaluated against it",
  },
  {
    label: "flowcms",
    path: "packages/flowcms/package.json",
    read: (text) => JSON.parse(text).version,
    write: (text, next) => setJsonVersion(text, next),
    why: "what npm resolves for the published theme API",
  },
  {
    label: "create-flowcms",
    path: "packages/create-flowcms/package.json",
    read: (text) => JSON.parse(text).version,
    write: (text, next) => setJsonVersion(text, next),
    why: "the scaffolder's own release number, reported by --version",
  },
]

/** The derived one. Reported, never written. */
const DERIVED = {
  label: "templateVersion",
  path: "packages/create-flowcms/template.json",
  read: (text) => JSON.parse(text).templateVersion,
  why: "derived by scripts/build-create-flowcms.mjs from FLOWCMS_VERSION",
}

/**
 * Rewrite `version` in a manifest by parsing it, not by regex.
 *
 * A regex over a manifest is how a project that depends on a package called
 * `next` gets its dependency's version rewritten along with its own. The
 * two-space indent and trailing newline match what every manifest in this
 * repository already uses, so the diff is one line.
 */
function setJsonVersion(text, next) {
  const parsed = JSON.parse(text)
  parsed.version = next
  return `${JSON.stringify(parsed, null, 2)}\n`
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/

/** Compare two semver cores. Prerelease ordering is not implemented — see below. */
function compareCore(a, b) {
  const [ax, ay, az] = a.split("-")[0].split(".").map(Number)
  const [bx, by, bz] = b.split("-")[0].split(".").map(Number)
  return ax - bx || ay - by || az - bz
}

function fail(message) {
  console.error(`\n[release-version-sync] ${message}\n`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes("--dry-run")
const ALLOW_DOWNGRADE = argv.includes("--allow-downgrade")

const setIndex = argv.indexOf("--set")
const target = setIndex === -1 ? null : argv[setIndex + 1]

for (const arg of argv) {
  if (arg === target) continue
  if (!["--set", "--dry-run", "--allow-downgrade", "--check"].includes(arg)) {
    // Refused rather than ignored: a scaffolder that accepts `--skipinstall`
    // runs an install the operator declined, and the same reasoning applies to
    // a release tool that accepts `--dryrun` and then writes files.
    fail(`Unknown option "${arg}". Usage: release-version-sync.mjs [--set <version>] [--dry-run] [--allow-downgrade]`)
  }
}

if (setIndex !== -1 && !target) fail("--set needs a version, e.g. --set 0.2.0")
if (target && !SEMVER.test(target)) fail(`"${target}" is not a semantic version.`)

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

const found = []
for (const source of SOURCES) {
  const path = join(ROOT, source.path)
  let text
  try {
    text = readFileSync(path, "utf8")
  } catch {
    fail(`${source.path} is missing. This is one of the three version sources; a release cannot proceed without it.`)
  }
  const version = source.read(text)
  if (!version) fail(`Could not read a version from ${source.path}. Has its shape changed?`)
  found.push({ ...source, text, version })
}

let derived = null
try {
  derived = DERIVED.read(readFileSync(join(ROOT, DERIVED.path), "utf8"))
} catch {
  // template.json is generated by the template build and is legitimately absent
  // on a clean checkout. Its absence is reported, never fatal.
}

const distinct = new Set(found.map((s) => s.version))
const current = found[0].version

console.log("\nFlowCMS version sources\n")
for (const source of found) {
  const flag = source.version === current ? " " : "!"
  console.log(`  ${flag} ${source.version.padEnd(12)} ${source.path}`)
  console.log(`      ${source.why}`)
}
console.log(`    ${(derived ?? "not built").padEnd(12)} ${DERIVED.path}  (derived)`)
console.log(`      ${DERIVED.why}`)

// ---------------------------------------------------------------------------
// Check mode — the default, and read-only
// ---------------------------------------------------------------------------

if (!target) {
  if (distinct.size > 1) {
    console.error(
      `\n[release-version-sync] The three hand-maintained sources disagree: ${[...distinct].join(", ")}.\n` +
        `Run with --set <version> to align them.\n`,
    )
    process.exit(1)
  }
  if (derived && derived !== current) {
    console.error(
      `\n[release-version-sync] template.json says ${derived} but FLOWCMS_VERSION is ${current}.\n` +
        `That file is generated — run \`npm run build:template\` rather than editing it.\n`,
    )
    process.exit(1)
  }
  console.log(`\n[release-version-sync] ok — everything says ${current}.\n`)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Set mode
// ---------------------------------------------------------------------------

if (target.includes("-") || current.includes("-")) {
  // Prerelease ordering (1.0.0-alpha < 1.0.0-beta < 1.0.0) is a real spec with
  // real edge cases, and implementing a partial version of it here would give a
  // wrong answer confidently. FlowCMS has no prerelease line; if one is ever
  // wanted, this is the place that has to grow up first.
  fail(
    `Prerelease versions are not supported by this tool (${current} → ${target}).\n` +
      `  Ordering them correctly is more than this script should be guessing at.\n` +
      `  Set the three sources by hand and record why in the release runbook.`,
  )
}

const direction = compareCore(target, current)
if (direction === 0) {
  console.log(`\n[release-version-sync] Already ${target}. Nothing to do.\n`)
  process.exit(0)
}
if (direction < 0 && !ALLOW_DOWNGRADE) {
  fail(
    `Refusing to move ${current} → ${target}: that is backwards.\n` +
      `  A version going down is almost always a typo. If it is not, pass --allow-downgrade.`,
  )
}

console.log(`\n${DRY_RUN ? "Would set" : "Setting"} ${current} → ${target}\n`)

for (const source of found) {
  const next = source.write(source.text, target)
  if (next === source.text) {
    fail(`Rewriting ${source.path} produced no change. The file's shape is not what this script expects — stopping rather than half-writing a release.`)
  }
  if (!DRY_RUN) writeFileSync(join(ROOT, source.path), next)
  console.log(`  ${DRY_RUN ? "would write" : "wrote"}  ${source.path}`)
}

console.log(
  `\n${DRY_RUN ? "Nothing was written." : "Done."} Next:\n` +
    `  1. npm run build:template     regenerate template.json (${DERIVED.path})\n` +
    `  2. update CHANGELOG.md's ${target} section\n` +
    `  3. the maintainer release runbook — this script does not commit, tag or publish\n`,
)
