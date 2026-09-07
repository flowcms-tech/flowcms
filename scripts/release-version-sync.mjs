#!/usr/bin/env node
/**
 * The FlowCMS version, in one place, checked or moved.
 *
 *   node scripts/release-version-sync.mjs                  check (the default)
 *   node scripts/release-version-sync.mjs --set 0.2.0       rewrite
 *   node scripts/release-version-sync.mjs --set 0.2.0 --dry-run
 *   node scripts/release-version-sync.mjs --set 0.2.0 --allow-downgrade
 *
 * THE SINGLE OWNER OF VERSION SYNCHRONISATION. If a file carries the FlowCMS
 * release number, moving it is this script's job and nobody else's.
 * `release-orchestrate.mjs` calls this and verifies the result; it does not
 * parse or rewrite a manifest itself, and a second implementation appearing
 * anywhere is the defect this sentence exists to prevent.
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all
 * ---------------------------------------------------------------------------
 *
 * There are five committed copies of the FlowCMS release number and one derived
 * one. Five is far too many to move by hand reliably, and the way they
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
 * - It does not WRITE `packages/create-flowcms/template.json`. That number is
 *   DERIVED: `scripts/build-create-flowcms.mjs` reads FLOWCMS_VERSION and
 *   writes it. Setting it here would create a second authority for one value,
 *   and the two would disagree the first time somebody ran only one of them.
 *   `--set` does RUN that builder afterwards, which is not the same thing: the
 *   authority stays FLOWCMS_VERSION, and regenerating is what stops the
 *   operator being told to go and run a second command they will forget.
 *
 * - It does not treat that derived file as an agreement requirement. It is
 *   gitignored, so its staleness is a fact about when a build last ran and not
 *   about the tree. A mismatch is reported; only the committed sources bind.
 *
 * - It does not commit, tag, push or publish. It edits files and stops. The
 *   release procedure is a maintainer runbook and it is performed by a
 *   person.
 *
 * - It does not move backwards without `--allow-downgrade`. A version going
 *   down is nearly always a typo, and on the one occasion it is not, saying so
 *   costs one flag.
 */

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * THE CANONICAL SOURCES: committed, hand-maintained, and required to agree.
 *
 * Everything in this list is in git, is read by something, and is written by
 * `--set`. A disagreement between any two of them is a hard failure, because a
 * checkout that disagrees with itself about what it is has no correct answer to
 * give anybody.
 *
 * The DERIVED artifact below is deliberately not in this list — see the comment
 * on it for why the distinction is load-bearing rather than tidy.
 */
export const SOURCES = [
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
  {
    label: "flowcms-app",
    path: "package.json",
    read: (text) => JSON.parse(text).version,
    write: (text, next) => setJsonVersion(text, next),
    why: "the application's own version — tests/packaging/versionAlignment.test.ts requires it to equal FLOWCMS_VERSION",
  },
  {
    label: "flowcms-app (lockfile)",
    path: "package-lock.json",
    /**
     * A lockfile carries the root version TWICE — at the top level and in
     * `packages[""]` — and npm keeps them in step. Reading both and refusing
     * when they disagree is what stops this script reporting one number while
     * the other quietly stays behind.
     */
    read: (text) => {
      const lock = JSON.parse(text)
      const top = lock.version
      const root = lock.packages?.[""]?.version
      if (top !== root) {
        fail(
          `package-lock.json disagrees with itself: version is ${top}, packages[""].version is ${root}.\n` +
            `  Run \`npm install --package-lock-only\` to make npm rewrite it consistently.`,
        )
      }
      return top
    },
    write: (text, next) => {
      const lock = JSON.parse(text)
      lock.version = next
      if (lock.packages?.[""]) lock.packages[""].version = next
      return `${JSON.stringify(lock, null, 2)}\n`
    },
    why: "the lockfile mirrors the root manifest, and a stale mirror is a diff nobody reads",
  },
]

/**
 * THE DERIVED ARTIFACT, and why it is not a canonical source.
 *
 * `template.json` is generated by `scripts/build-create-flowcms.mjs` from
 * FLOWCMS_VERSION, and it is GITIGNORED. That combination is what makes it a
 * different kind of thing: it is never committed, so it says nothing about
 * whether the tree is consistent — only about when somebody last ran a build.
 *
 * Treating it as an agreement requirement therefore fails for a reason nobody
 * can act on. Switch branches, or check out an older commit after building, and
 * a file no commit contains makes a release refuse to start. So a mismatch here
 * is REPORTED and regenerated, never fatal in check mode; `--set` rebuilds it
 * so that after a bump the generated copy really does follow.
 */
export const DERIVED = {
  label: "templateVersion",
  path: "packages/create-flowcms/template.json",
  builder: "scripts/build-create-flowcms.mjs",
  read: (text) => JSON.parse(text).templateVersion,
  why: "derived by scripts/build-create-flowcms.mjs from FLOWCMS_VERSION; gitignored, so never an agreement requirement",
}

/**
 * Every canonical source's current version, for callers that need the answer
 * without re-implementing how each file stores it.
 *
 * `scripts/release-orchestrate.mjs` verifies a bump through this rather than
 * parsing manifests itself — one owner for "where the version lives", which is
 * the whole point of this file existing.
 *
 * @returns {{ path: string, label: string, version: string | undefined }[]}
 */
export function readVersions() {
  return SOURCES.map((source) => ({
    path: source.path,
    label: source.label,
    version: source.read(readFileSync(join(ROOT, source.path), "utf8")),
  }))
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
// THE CLI.
//
// Guarded so this file can be IMPORTED for its SOURCES, DERIVED and
// readVersions() without the command line running. Without the guard, a test
// or a caller importing it would print a report and call process.exit — which
// is exactly what stopped release-orchestrate.mjs reusing this file and left
// it reimplementing the same edits.
// ---------------------------------------------------------------------------
function main() {
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
      fail(`${source.path} is missing. This is one of the canonical version sources; a release cannot proceed without it.`)
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
        `\n[release-version-sync] The committed version sources disagree: ${[...distinct].join(", ")}.\n` +
          `Run with --set <version> to align them.\n`,
      )
      process.exit(1)
    }
    // A STALE DERIVED ARTIFACT IS A NOTE, NOT A FAILURE.
    //
    // This used to exit 1, and it was wrong to: `template.json` is gitignored, so
    // its staleness is a fact about when a build last ran, not about the tree.
    // Switching branches was enough to make a release refuse to start, naming a
    // file no commit carries. Regenerating is the fix and the message says so.
    if (derived && derived !== current) {
      console.log(
        `\n[release-version-sync] note: ${DERIVED.path} says ${derived}, the tree says ${current}.\n` +
          `That file is generated and gitignored — \`npm run build:template\` regenerates it.\n` +
          `The committed sources agree, so this is not a release blocker.\n`,
      )
    }
    console.log(`\n[release-version-sync] ok — every committed source says ${current}.\n`)
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
        `  Set the canonical sources by hand and record why in the release runbook.`,
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

  // THE DERIVED ARTIFACT, REGENERATED RATHER THAN LEFT BEHIND.
  //
  // The moment the canonical sources move, the generated template is a version
  // behind. Telling the operator to go and run a second command is how the two
  // drift, and it is the step that was actually being forgotten. `--dry-run`
  // writes nothing, so it must not build either.
  if (!DRY_RUN) {
    console.log(`\n  regenerating ${DERIVED.path}…`)
    try {
      // `process.execPath`, not "npm": Node 22 on Windows refuses to spawn
      // `npm.cmd` without a shell, and a release tool that needs a shell on one
      // platform is a release tool that is broken on that platform.
      execFileSync(process.execPath, [join(ROOT, DERIVED.builder)], { cwd: ROOT, stdio: "pipe" })
    } catch (error) {
      fail(
        `${DERIVED.builder} failed, so ${DERIVED.path} still says the old version.\n` +
          `  The canonical sources are already at ${target}; rerun the builder before releasing.\n` +
          `  ${String(error?.message ?? error).split("\n")[0]}`,
      )
    }
    const rebuilt = DERIVED.read(readFileSync(join(ROOT, DERIVED.path), "utf8"))
    if (rebuilt !== target) {
      fail(`${DERIVED.path} still says ${rebuilt} after rebuilding. Expected ${target}.`)
    }
    console.log(`  rebuilt     ${DERIVED.path}  (${rebuilt})`)
  }

  console.log(
    `\n${DRY_RUN ? "Nothing was written." : "Done."} Next:\n` +
      `${DRY_RUN ? `  1. npm run build:template     regenerate template.json (${DERIVED.path})\n` : ""}` +
      `  ${DRY_RUN ? "2" : "1"}. update CHANGELOG.md's ${target} section\n` +
      `  ${DRY_RUN ? "3" : "2"}. the maintainer release runbook — this script does not commit, tag or publish\n`,
  )

}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
