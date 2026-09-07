#!/usr/bin/env node
/**
 * WHICH RELEASE PATH THIS MERGE EARNS.
 *
 * There are two, and they differ only in how much is proved before the same
 * publish job runs:
 *
 *   full   ci + database matrix + consumer proofs + Docker + portability.
 *          Fifteen to twenty minutes. The default, and what every release
 *          before this script got.
 *   fast   ci alone — lockfile, typecheck, lint, the whole vitest suite and
 *          artifact hygiene — for a patch whose diff cannot reach anything the
 *          other four tiers exist to cover.
 *
 * Nothing about the PUBLISH changes between them. The registry preflight, the
 * tag/version agreement, the immutability check, the artifact hygiene pass
 * immediately before `npm publish`, the OIDC exchange and the `npm-publish`
 * environment's reviewer are the same steps in the same order either way. What
 * a fast release buys is fewer PROOFS, so this file's whole job is to refuse
 * the fast path for any change whose proof would have been the missing one.
 *
 * THREE CONDITIONS, ALL REQUIRED. Any one of them absent means full, and the
 * decision is reported with the reason rather than silently downgraded:
 *
 *   1. OPT-IN. The merge commit carries a `Release-Path: fast` trailer. Never
 *      inferred: a small diff is not a request for a shallower proof, and the
 *      person merging is the one who knows whether it is.
 *   2. A PATCH BUMP. `X.Y.Z` -> `X.Y.Z+1` against the previous tag, and
 *      nothing else. A minor or major bump cannot take this path however it is
 *      labelled, because "the surface did not change" is exactly the claim a
 *      minor bump withdraws.
 *   3. A DIFF THAT STAYS INSIDE THE LOW-RISK SET. Every file changed since the
 *      previous tag is either allowed outright, or is one of the version
 *      manifests changed on its version line and nowhere else.
 *
 * FAIL CLOSED, AND ALLOWLIST RATHER THAN DENYLIST. A path this file has never
 * heard of forces the full path. That is the direction the mistake has to fall
 * in: a new top-level directory, a new config file, a new packaging input
 * appears, and the fast path stops offering itself until somebody decides the
 * cheap tier really does cover it. The reverse — a denylist that has not
 * learned about the new thing yet — publishes it unproven.
 *
 * Exported for tests/ci/releasePath.test.ts, which is where the interesting
 * cases live; the CLI below is only the part that reads git.
 *
 * Usage:
 *   node scripts/ci/decide-release-path.mjs                 # reports, exit 0
 *   node scripts/ci/decide-release-path.mjs --github-output # writes $GITHUB_OUTPUT too
 */

import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/**
 * The trailer, and only in trailer position: at the start of a line, in the
 * commit message. A `Release-Path: fast` quoted inside a paragraph of prose
 * describing this mechanism must not opt a release in — a real risk in a
 * repository whose commit messages explain themselves at length.
 */
export const FAST_TRAILER = /^Release-Path:[ \t]*fast[ \t]*$/im

/**
 * The three hand-maintained version sources, in the shape
 * `scripts/release-version-sync.mjs` already agrees on. They change on EVERY
 * release, so a rule that refused them would refuse every fast release; they
 * are allowed only when the diff touches the version line and nothing else,
 * which is what keeps a dependency added in the same commit from riding along.
 */
export const VERSION_MANIFESTS = [
  "src/Themes/contract/version.ts",
  "packages/flowcms/package.json",
  "packages/create-flowcms/package.json",
]

/**
 * WHAT THE CI TIER DOES NOT COVER, checked first so a deny always beats an
 * allow. Each entry names the tier that would have caught it — which is the
 * test for whether a new pattern belongs in this list.
 */
export const NEVER_FAST = [
  {
    pattern: /^\.github\//,
    tier: "the pipeline itself — a workflow change is not provable by the workflows",
  },
  { pattern: /^scripts\//, tier: "build, packaging and release tooling — the consumer proofs" },
  { pattern: /^src\/db\//, tier: "schema and dialect derivation — the four-engine database matrix" },
  { pattern: /^drizzle\./, tier: "migration generation — the database matrix" },
  { pattern: /^docker\//, tier: "the image — the Docker tier" },
  { pattern: /^Dockerfile/, tier: "the image — the Docker tier" },
  { pattern: /^\.dockerignore$/, tier: "the image build context — the Docker tier" },
  { pattern: /^compose[.-]/, tier: "the compose topologies — the database topology matrix" },
  { pattern: /^package\.json$/, tier: "the dependency tree — every tier that installs" },
  { pattern: /^package-lock\.json$/, tier: "the dependency tree — every tier that installs" },
  { pattern: /^bun\.lock$/, tier: "the package-manager matrix — portability" },
  { pattern: /^next\.config\./, tier: "the production build — the consumer proofs" },
  { pattern: /^tsconfig[^/]*\.json$/, tier: "resolution and emit — the consumer proofs" },
  { pattern: /^vitest\.config\./, tier: "what the suite even runs" },
  { pattern: /^eslint\.config\./, tier: "what lint even checks" },
  { pattern: /^postcss\.config\./, tier: "CSS compilation — the production build" },
  { pattern: /^components\.json$/, tier: "component generation — the production build" },
  { pattern: /^packages\//, tier: "the published packages themselves — the consumer proofs" },
]

/**
 * WHAT THE CI TIER DOES COVER. `src/` is here because `npm test` runs the whole
 * vitest suite over it and `tsc --noEmit` typechecks it; `tests/` because a
 * test change is proved by running the tests. Documentation and the changelog
 * are the text changes this path was asked for in the first place.
 */
export const FAST_ELIGIBLE = [
  /^src\//,
  /^tests\//,
  /^docs\//,
  /^public\//,
  /^CHANGELOG\.md$/,
  /^README\.md$/,
  /^CONTRIBUTING\.md$/,
  /^CODE_OF_CONDUCT\.md$/,
  /^SECURITY\.md$/,
  /^LICENSE$/,
  /^\.env\.example$/,
]

/**
 * Semantic versions, strictly. A prerelease or build suffix is not a patch bump
 * this file knows how to reason about, so it does not pretend to.
 */
function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? "").trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

/**
 * `X.Y.Z` -> `X.Y.Z+1`, and nothing else counts.
 *
 * @param {string | null | undefined} previous
 * @param {string | null | undefined} next
 * @returns {boolean}
 */
export function isPatchBump(previous, next) {
  const before = parseVersion(previous)
  const after = parseVersion(next)
  if (!before || !after) return false
  return (
    before.major === after.major &&
    before.minor === after.minor &&
    after.patch === before.patch + 1
  )
}

/**
 * One file's verdict.
 *
 * `versionOnlyManifests` is the set of version manifests whose diff was found
 * to touch version lines only. It is computed from git by the caller rather
 * than here, so that the interesting half of this file stays a pure function.
 *
 * Always the same shape — `{ eligible, why }`, with `why` null when eligible —
 * rather than one shape per branch. The caller collects `why` from whatever it
 * refused, and a union of shapes would make that a narrowing exercise for no
 * gain.
 *
 * The JSDoc types here and on `decideReleasePath` are load-bearing rather than
 * decorative: `tests/ci/releasePath.test.ts` is TypeScript importing this
 * module, and without them `tsc` infers the `= []` defaults as `never[]` and
 * refuses every call the suite makes.
 *
 * @param {string} path
 * @param {readonly string[]} [versionOnlyManifests]
 * @returns {{ eligible: boolean, why: string | null }}
 */
export function classifyPath(path, versionOnlyManifests = []) {
  const isManifest = VERSION_MANIFESTS.includes(path)
  const isVersionOnly = isManifest && versionOnlyManifests.includes(path)
  const beyondVersion = {
    eligible: false,
    why: `${path} changed beyond its version line, so this is not only a version bump`,
  }

  for (const { pattern, tier } of NEVER_FAST) {
    if (!pattern.test(path)) continue
    // A version manifest under `packages/` is the one case where a NEVER_FAST
    // pattern has a legitimate exception, and only for a version-only diff.
    if (isVersionOnly) return { eligible: true, why: null }
    if (isManifest) return beyondVersion
    return { eligible: false, why: `${path} is covered by ${tier}` }
  }

  if (isManifest) return isVersionOnly ? { eligible: true, why: null } : beyondVersion

  if (FAST_ELIGIBLE.some((pattern) => pattern.test(path))) return { eligible: true, why: null }

  return {
    eligible: false,
    why: `${path} matches nothing the fast path knows the CI tier to cover`,
  }
}

/**
 * DOES THIS DIFF NEED THE DEEP TIERS? The one question both callers ask.
 *
 * Extracted so the allowlist has exactly one home. Two things consult it:
 *
 *   - `decideReleasePath` below, as the third of its three conditions.
 *   - `portability.yml`'s `changes` job, which uses it to decide whether a pull
 *     request has to pay for the Windows and macOS suites.
 *
 * They are not the same question and must not be collapsed into one: a release
 * additionally demands an opt-in trailer and a patch bump, neither of which
 * means anything for a pull request. What they share is precisely this — which
 * PATHS the CI tier can prove on its own — and sharing it is what stops the
 * list drifting into two lists that disagree about `src/db/`.
 *
 * Deep is the safe answer, so an empty or unknown diff returns deep.
 *
 * @param {readonly string[]} changedFiles
 * @param {readonly string[]} [versionOnlyManifests]
 * @returns {{ deep: boolean, reasons: string[] }}
 */
export function needsDeepProof(changedFiles = [], versionOnlyManifests = []) {
  /** @type {string[]} */
  const reasons = []

  if (changedFiles.length === 0) {
    reasons.push("no changed file could be determined, and an unknown diff is not a small one")
  }

  for (const path of changedFiles) {
    const verdict = classifyPath(path, versionOnlyManifests)
    if (!verdict.eligible && verdict.why) reasons.push(verdict.why)
  }

  return { deep: reasons.length > 0, reasons }
}

/**
 * THE DECISION. Pure: every git fact it needs is already an argument.
 *
 * Returns every blocker rather than the first one. A maintainer who typed the
 * trailer on a minor bump that also touches the Dockerfile should be told both
 * things at once instead of discovering them one release attempt at a time.
 *
 * @param {{
 *   version: string,
 *   previousTag?: string | null,
 *   commitMessage?: string,
 *   changedFiles?: readonly string[],
 *   versionOnlyManifests?: readonly string[],
 * }} facts
 * @returns {{ fast: boolean, blockers: string[] }}
 */
export function decideReleasePath({
  version,
  previousTag,
  commitMessage = "",
  changedFiles = [],
  versionOnlyManifests = [],
}) {
  /** @type {string[]} */
  const blockers = []

  if (!FAST_TRAILER.test(commitMessage)) {
    blockers.push(
      "the merge commit carries no `Release-Path: fast` trailer, so no fast release was asked for",
    )
  }

  const previousVersion =
    typeof previousTag === "string" && previousTag ? previousTag.replace(/^v/, "") : null
  if (!previousVersion) {
    blockers.push("there is no previous release tag to measure a patch bump against")
  } else if (!isPatchBump(previousVersion, version)) {
    blockers.push(
      `${previousVersion} -> ${version} is not a patch bump; only X.Y.Z -> X.Y.Z+1 may take the fast path`,
    )
  }

  // The third condition, delegated rather than repeated. `portability.yml` asks
  // the same question of a pull request's diff, and one list is the whole point.
  blockers.push(...needsDeepProof(changedFiles, versionOnlyManifests).reasons)

  return { fast: blockers.length === 0, blockers }
}

// ---------------------------------------------------------------------------
// The CLI. Reads git, calls the function above, reports.
// ---------------------------------------------------------------------------

const git = (...args) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })

function readVersion() {
  const source = readFileSync(join(ROOT, "src/Themes/contract/version.ts"), "utf8")
  const match = source.match(/FLOWCMS_VERSION\s*=\s*"([^"]+)"/)
  if (!match) {
    throw new Error("FLOWCMS_VERSION could not be read from src/Themes/contract/version.ts")
  }
  return match[1]
}

function previousReleaseTag() {
  try {
    return git("describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD").trim() || null
  } catch {
    // No tag reachable from HEAD. Genuinely possible for a first release, and
    // the right answer there is the full path rather than a guess.
    return null
  }
}

/**
 * Does this manifest's diff touch version lines and nothing else?
 *
 * `-U0` so the hunks carry no context lines to mistake for changes. Every
 * remaining `+`/`-` line then has to be the version, in the one shape each file
 * stores it in.
 */
function isVersionOnlyDiff(from, path) {
  const changed = git("diff", "-U0", `${from}..HEAD`, "--", path)
    .split("\n")
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line))
  if (changed.length === 0) return false
  return changed.every((line) =>
    /^[+-]\s*(?:"version"\s*:\s*"[^"]*",?|export const FLOWCMS_VERSION = "[^"]*")\s*$/.test(line),
  )
}

/**
 * The changed files between a base ref and HEAD, plus which version manifests
 * moved only on their version line. Shared by both CLI modes so a pull request
 * and a release classify an identical diff identically.
 */
function diffAgainst(from) {
  const changedFiles = git("diff", "--name-only", `${from}...HEAD`)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  const versionOnlyManifests = VERSION_MANIFESTS.filter(
    (path) => changedFiles.includes(path) && isVersionOnlyDiff(from, path),
  )
  return { changedFiles, versionOnlyManifests }
}

/**
 * `--pr-gate` — the question `portability.yml` asks before paying for the
 * Windows and macOS suites.
 *
 * FAILS CLOSED THREE WAYS, and each of them is a real state rather than a
 * defensive flourish:
 *
 *   - not a pull request (no base ref)     -> deep. A push to main, a release
 *     and the nightly all prove everything, which is what they are for.
 *   - the base ref will not resolve        -> deep. A shallow checkout or a
 *     renamed branch must not be read as "nothing changed".
 *   - anything thrown                      -> the process exits non-zero, the
 *     job fails, and the gate that `needs:` it fails with it.
 *
 * It writes `deep`, never `fast`, so the absent output reads as the safe answer
 * if the step is ever removed: `needs.changes.outputs.deep == 'true'` is false
 * on an empty string, but the gate's own `needs` on this job is what catches
 * that — see the comment above `Portability gate`.
 */
function prGate() {
  const baseIndex = process.argv.indexOf("--base")
  const base = baseIndex === -1 ? "" : (process.argv[baseIndex + 1] ?? "").trim()

  /** @type {{ deep: boolean, reasons: string[] }} */
  let verdict

  if (!base) {
    verdict = {
      deep: true,
      reasons: ["this is not a pull request, and every other trigger proves everything"],
    }
  } else if (!resolves(`origin/${base}`)) {
    verdict = {
      deep: true,
      reasons: [`origin/${base} does not resolve, so the diff cannot be read and is not assumed small`],
    }
  } else {
    const { changedFiles, versionOnlyManifests } = diffAgainst(`origin/${base}`)
    verdict = needsDeepProof(changedFiles, versionOnlyManifests)
    console.log(`changed: ${changedFiles.length} file(s) against origin/${base}`)
    for (const path of changedFiles) console.log(`  ${path}`)
  }

  console.log(
    verdict.deep
      ? "deep proof REQUIRED — the portability legs will run"
      : "deep proof not required — the portability legs may be skipped",
  )
  for (const reason of verdict.reasons) console.log(`  - ${reason}`)

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `deep=${verdict.deep}\n`)
  }
}

/** Does this ref exist? Used to fail closed on a base that will not resolve. */
function resolves(ref) {
  try {
    git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`)
    return true
  } catch {
    return false
  }
}

function main() {
  if (process.argv.includes("--pr-gate")) return prGate()

  const version = readVersion()
  const previousTag = previousReleaseTag()
  const commitMessage = git("log", "-1", "--format=%B", "HEAD")

  // The same diff helper the pull-request gate uses, so the two modes cannot
  // classify the same change differently. The previous tag is an ancestor of
  // HEAD on main, which makes the three-dot range identical to the two-dot one
  // here and correct for the merge-base case there.
  const { changedFiles, versionOnlyManifests } = previousTag
    ? diffAgainst(previousTag)
    : { changedFiles: [], versionOnlyManifests: [] }

  const { fast, blockers } = decideReleasePath({
    version,
    previousTag,
    commitMessage,
    changedFiles,
    versionOnlyManifests,
  })

  console.log(`version:      ${version}`)
  console.log(`previous tag: ${previousTag ?? "(none)"}`)
  console.log(
    `changed:      ${changedFiles.length} file(s) since ${previousTag ?? "the beginning"}`,
  )
  console.log(`path:         ${fast ? "FAST (the CI tier only)" : "FULL (every tier)"}`)
  if (!fast) {
    console.log("")
    console.log("The full path was chosen because:")
    for (const blocker of blockers) console.log(`  - ${blocker}`)
  }

  if (process.argv.includes("--github-output") && process.env.GITHUB_OUTPUT) {
    const reason = fast
      ? "A patch bump, opted in, with a diff the CI tier covers."
      : blockers.map((blocker) => `- ${blocker}`).join("\n")
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `fast=${fast}\nreason=${reason.replace(/\r?\n/g, "%0A")}\n`,
    )
  }
}

// Only when run, never when imported by the test suite.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
