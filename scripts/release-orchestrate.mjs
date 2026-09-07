#!/usr/bin/env node
/**
 * THE RELEASE OPERATOR.
 *
 * This file releases nothing. It drives, in order, the machinery that already
 * exists: `release-version-sync.mjs` bumps the three version sources,
 * `release-on-merge.yml` turns the merge into a tag and a dispatch,
 * `release.yml` proves and publishes, and `decide-release-path.mjs` decides
 * whether that proof is the fast one. Nothing here duplicates any of them, and
 * no workflow, ruleset or repository setting is touched.
 *
 * WHAT IT ADDS is the part that was a person with two browser tabs: the
 * two-identity dance, the waiting, and the checks nobody performs reliably at
 * eleven at night.
 *
 * TWO IDENTITIES, NEVER A GLOBAL SWITCH.
 *
 *   mbehzad-bhz    the active `gh` account. Branches, commits, pushes, opens
 *                  the pull request. Everything reversible.
 *   flowcms-tech   the CODEOWNER and the `npm-publish` reviewer. Submits the
 *                  approval, merges, releases the deployment.
 *
 * `gh auth switch` is never called. Every `flowcms-tech` action passes
 * `GH_TOKEN` for one process, so identity is an argument rather than ambient
 * state and an interrupted run cannot strand the wrong account active.
 *
 * TWO COMMANDS, AND ONLY ONE OF THEM CAN DO ANYTHING IRREVERSIBLE.
 *
 *   prepare   branch, bump, push, open the pull request. Safe by construction:
 *             it holds no path to approve, merge or publish.
 *   publish   the whole irreversible run, and it refuses without the exact
 *             confirmation phrase `release.yml` itself demands. A pull request
 *             existing and its checks going green is NOT an instruction to
 *             publish, which is the property this split exists to guarantee.
 *
 * STATE IS DERIVED FROM THE WORLD, NEVER FROM A FILE BESIDE IT. There is no
 * `.release-state.json` to go stale, be committed by accident, or disagree with
 * the repository. Every run asks GitHub and npm what actually happened and
 * rejoins at the first incomplete step, so an interrupted run is resumed by
 * running the same command again.
 *
 * Usage:
 *   node scripts/release-orchestrate.mjs prepare --version 0.2.2 [--mode fast|full]
 *   node scripts/release-orchestrate.mjs status  [--version 0.2.2]
 *   node scripts/release-orchestrate.mjs publish --confirm "PUBLISH FLOWCMS"
 *                                                [--pause-before-deploy]
 */

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { isPatchBump, needsDeepProof, VERSION_MANIFESTS } from "./ci/decide-release-path.mjs"
import { readVersions } from "./release-version-sync.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

/** The account that must stay active. Everything reversible happens as it. */
export const AUTHOR = "mbehzad-bhz"

/**
 * The account that approves and merges. It is also the `npm-publish`
 * environment's required reviewer, and preflight asserts that rather than
 * trusting this constant — if somebody changes the environment, this file finds
 * out instead of failing halfway through a release.
 */
export const APPROVER = "flowcms-tech"

/** The same phrase `release.yml` gates its publish job on. One phrase, not two. */
export const CONFIRMATION = "PUBLISH FLOWCMS"

export const ENVIRONMENT = "npm-publish"
export const PACKAGES = ["flowcms", "create-flowcms"]

// ---------------------------------------------------------------------------
// The pure half. Everything below `main()` reads git, gh or npm; everything
// here is a decision, which is what makes tests/release/orchestration.test.ts
// able to cover the cases that matter without a network.
// ---------------------------------------------------------------------------

/**
 * The dated changelog heading `release-on-merge.yml` demands before it will
 * create a tag. Checked here too, and deliberately: discovering it in CI means
 * discovering it after the branch, the bump and the pull request already exist.
 *
 * @param {string} changelog
 * @param {string} version
 * @returns {boolean}
 */
export function changelogHasDatedSection(changelog, version) {
  return new RegExp(
    `^## \\[${version.replace(/\./g, "\\.")}\\][^\\n]*\\d{4}-\\d{2}-\\d{2}`,
    "m",
  ).test(changelog)
}

/**
 * THE MERGE COMMIT MESSAGE, and the one place the fast path is actually
 * requested.
 *
 * `decide-release-path.mjs` reads the trailer from `git log -1 HEAD` on main —
 * which is the MERGE commit, not any commit in the branch. A trailer written
 * into the release commit is invisible to it, and the release silently runs
 * full. So it goes here, in what `gh pr merge --body` sends.
 *
 * @param {string} version
 * @param {"fast" | "full"} mode
 * @returns {string}
 */
export function mergeBody(version, mode) {
  const lines = [`Release ${version}.`]
  if (mode === "fast") lines.push("", "Release-Path: fast")
  return `${lines.join("\n")}\n`
}

/**
 * WHERE THIS RELEASE HAS GOT TO. Probed newest-first, so a resumed run rejoins
 * at the first thing that has not happened yet rather than redoing what has.
 *
 * @param {{
 *   published?: boolean,
 *   deploymentApproved?: boolean,
 *   pendingDeployment?: boolean,
 *   tagExists?: boolean,
 *   pr?: { state?: string, approvedByApprover?: boolean } | null,
 * }} facts
 * @returns {"PUBLISHED"|"PUBLISHING"|"AWAITING_APPROVAL"|"TAGGED"|"MERGED"|"APPROVED"|"PR_OPEN"|"IDLE"}
 */
export function deriveState(facts) {
  if (facts.published) return "PUBLISHED"
  if (facts.pendingDeployment) return "AWAITING_APPROVAL"
  if (facts.deploymentApproved) return "PUBLISHING"
  if (facts.tagExists) return "TAGGED"
  if (facts.pr?.state === "MERGED") return "MERGED"
  if (facts.pr?.approvedByApprover) return "APPROVED"
  if (facts.pr) return "PR_OPEN"
  return "IDLE"
}

/**
 * THE GATE BEFORE THE APPROVAL.
 *
 * Deliberately does NOT require `mergeStateStatus: CLEAN`, and that is the
 * subtlety worth writing down. Before an approving review exists, main's
 * ruleset holds the pull request at BLOCKED — that is the missing review we are
 * about to supply, so demanding CLEAN here would make the approval
 * unreachable and the whole tool inert.
 *
 * What it does demand is everything the approval should not paper over: the
 * checks that main requires are green, no conversation is left unresolved, and
 * the branch is neither conflicted nor a draft.
 *
 * @param {{
 *   state: string,
 *   isDraft?: boolean,
 *   mergeStateStatus?: string,
 *   unresolvedThreads: number,
 *   checks: { name: string, conclusion: string }[],
 * }} pr
 * @param {readonly string[]} requiredChecks
 * @returns {{ ok: boolean, blockers: string[] }}
 */
export function approvalGate(pr, requiredChecks) {
  /** @type {string[]} */
  const blockers = []

  if (pr.state !== "OPEN") blockers.push(`the pull request is ${pr.state}, not OPEN`)
  if (pr.isDraft) blockers.push("the pull request is a draft")

  // DIRTY is a conflict; BEHIND means the branch no longer matches what the
  // checks ran against, which also makes the fast-path classification a guess.
  if (pr.mergeStateStatus === "DIRTY") blockers.push("the pull request has merge conflicts")
  if (pr.mergeStateStatus === "BEHIND") blockers.push("the branch is behind main; update it and let the checks re-run")

  if (pr.unresolvedThreads > 0) {
    blockers.push(`${pr.unresolvedThreads} review thread(s) are unresolved`)
  }

  for (const name of requiredChecks) {
    const check = pr.checks.find((c) => c.name === name)
    if (!check) blockers.push(`required check "${name}" has not reported`)
    else if (check.conclusion !== "SUCCESS") {
      blockers.push(`required check "${name}" is ${check.conclusion || "still running"}`)
    }
  }

  return { ok: blockers.length === 0, blockers }
}

/**
 * THE GATE BEFORE THE MERGE. Everything above, plus the two things that only
 * become true afterwards.
 *
 * `flowcms-tech` is a configured bypass actor on main's ruleset
 * (`bypass_mode: pull_request`) and CAN merge with nothing satisfied — pull
 * request #13 was merged with no review at all. This gate is the refusal to use
 * that: a real, non-dismissed approving review must exist, and GitHub must
 * independently agree the review rules are met.
 *
 * WHY IT CHECKS `reviewDecision` AND NOT `mergeStateStatus: CLEAN`, which is
 * the obvious thing to write and is wrong here.
 *
 * Main's ruleset carries an `update` rule — only bypass actors may update the
 * ref at all. That makes `mergeStateStatus` PERMANENTLY `BLOCKED` on this
 * repository, for every viewer, however green and approved a pull request is;
 * it is a statement about who may write to the branch, not about whether the
 * rules are satisfied. Gating on CLEAN therefore refuses every merge forever —
 * the same class of inertness `approvalGate` avoids one step earlier, and it
 * was caught auditing the pull request that introduced this file.
 *
 * `reviewDecision` is the verdict actually wanted: GitHub's own answer to
 * "are the review requirements met", code owners included. Paired with the
 * explicit approver check and everything `approvalGate` already demands, it
 * refuses exactly what the CLEAN check was meant to refuse, and nothing else.
 *
 * @param {Parameters<typeof approvalGate>[0] & { reviewDecision?: string }} pr
 * @param {{ author: string, state: string }[]} reviews
 * @param {readonly string[]} requiredChecks
 * @returns {{ ok: boolean, blockers: string[] }}
 */
export function mergeGate(pr, reviews, requiredChecks) {
  const { blockers } = approvalGate(pr, requiredChecks)

  const approved = reviews.some(
    (review) => review.author === APPROVER && review.state === "APPROVED",
  )
  if (!approved) blockers.push(`no current APPROVED review from ${APPROVER}`)

  if (pr.reviewDecision !== "APPROVED") {
    blockers.push(
      `GitHub reports reviewDecision ${pr.reviewDecision ?? "none"}; the review requirements are not met`,
    )
  }

  return { ok: blockers.length === 0, blockers }
}

/**
 * WILL THE RELEASE ACTUALLY BE FAST? Asked before the merge rather than read
 * off a workflow summary afterwards.
 *
 * The classifier judges everything since the PREVIOUS TAG, not just this pull
 * request — so an unrelated merge that touched `scripts/` since the last
 * release makes this one full however it is labelled. Predicting it here is the
 * difference between choosing the full path and being surprised by it.
 *
 * @param {{ mode: string, version: string, previousTag: string | null, changedFiles: readonly string[], versionOnlyManifests: readonly string[] }} facts
 * @returns {{ eligible: boolean, reasons: string[] }}
 */
export function predictFastEligibility({
  mode,
  version,
  previousTag,
  changedFiles,
  versionOnlyManifests,
}) {
  if (mode !== "fast") return { eligible: false, reasons: ["not requested"] }

  /** @type {string[]} */
  const reasons = []
  const previousVersion = previousTag ? previousTag.replace(/^v/, "") : null

  if (!previousVersion) reasons.push("there is no previous release tag to measure a patch bump against")
  else if (!isPatchBump(previousVersion, version)) {
    reasons.push(`${previousVersion} -> ${version} is not a patch bump`)
  }

  reasons.push(...needsDeepProof(changedFiles, versionOnlyManifests).reasons)

  return { eligible: reasons.length === 0, reasons }
}

// ---------------------------------------------------------------------------
// The impure half: git, gh, npm.
// ---------------------------------------------------------------------------

const run = (file, args, env) =>
  execFileSync(file, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  })

const git = (...args) => run("git", args).trimEnd()
const gh = (...args) => run("gh", args).trimEnd()

/** One `gh` invocation as the approver. No `gh auth switch`, ever. */
const ghAs = (user, ...args) => run("gh", args, { GH_TOKEN: gh("auth", "token", "--user", user) })

const ghJson = (...args) => JSON.parse(gh(...args))
const ghJsonAs = (user, ...args) => JSON.parse(ghAs(user, ...args))

const say = (message) => console.log(message)
const fail = (message) => {
  console.error(`\n  REFUSED: ${message}\n`)
  process.exit(1)
}

function repoSlug() {
  const url = git("remote", "get-url", "origin")
  const match = /github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/.exec(url)
  if (!match) fail(`cannot read a GitHub repository out of the origin remote (${url})`)
  return `${match[1]}/${match[2]}`
}

function currentVersion() {
  const source = readFileSync(join(ROOT, "src/Themes/contract/version.ts"), "utf8")
  return source.match(/FLOWCMS_VERSION\s*=\s*"([^"]+)"/)?.[1] ?? null
}

function previousReleaseTag() {
  try {
    return git("describe", "--tags", "--abbrev=0", "--match", "v*", "origin/main").trim() || null
  } catch {
    return null
  }
}

/** The checks main's ruleset requires, read from the ruleset rather than copied. */
function requiredChecks(repo) {
  const rules = ghJson("api", `repos/${repo}/rules/branches/main`)
  const rule = rules.find((r) => r.type === "required_status_checks")
  const contexts = rule?.parameters?.required_status_checks?.map((c) => c.context) ?? []
  if (contexts.length === 0) fail("main's ruleset requires no status checks; refusing to guess which matter")
  return contexts
}

// ---------------------------------------------------------------------------
// PREFLIGHT. Shared by both commands, and run before either does anything.
// ---------------------------------------------------------------------------

function preflight(repo) {
  if (git("status", "--porcelain")) fail("the working tree is not clean")

  // Parsed from the text, deliberately: `gh auth status --json` demands a field
  // list and has no field for the active login, so the human-readable output is
  // the only place it appears.
  const activeLogin = gh("auth", "status", "--active").match(/account (\S+)/)?.[1] ?? null
  if (activeLogin !== AUTHOR) {
    fail(`the active gh account is ${activeLogin ?? "unknown"}, expected ${AUTHOR}`)
  }

  let approver
  try {
    approver = ghJsonAs(APPROVER, "api", "user", "--jq", "{login:.login,id:.id}")
  } catch {
    fail(`no usable token for ${APPROVER}. Check \`gh auth token --user ${APPROVER}\``)
  }
  if (approver.login !== APPROVER) {
    fail(`the ${APPROVER} token resolves to ${approver.login}`)
  }

  // The environment's reviewer is the authority; APPROVER is checked against it
  // rather than trusted, so a settings change is caught here and not mid-run.
  const environment = ghJson("api", `repos/${repo}/environments/${ENVIRONMENT}`)
  const reviewers = (environment.protection_rules ?? [])
    .filter((rule) => rule.type === "required_reviewers")
    .flatMap((rule) => rule.reviewers.map((r) => r.reviewer.login))
  if (!reviewers.includes(APPROVER)) {
    fail(`${ENVIRONMENT}'s required reviewers are [${reviewers.join(", ")}], which does not include ${APPROVER}`)
  }

  say(`  preflight: tree clean, active ${AUTHOR}, ${APPROVER} token valid, ${ENVIRONMENT} reviewer ${APPROVER}`)
}

// ---------------------------------------------------------------------------
// Pull-request facts.
// ---------------------------------------------------------------------------

function findPullRequest(repo, branch) {
  const found = ghJson(
    "pr", "list", "--repo", repo, "--head", branch, "--state", "all",
    "--json", "number,state,baseRefName",
  )
  return found[0] ?? null
}

function pullRequestFacts(repo, number) {
  const pr = ghJson(
    "pr", "view", String(number), "--repo", repo,
    "--json", "state,isDraft,mergeStateStatus,reviewDecision,baseRefName,headRefName,statusCheckRollup,reviews,url",
  )

  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}`
  const [owner, name] = repo.split("/")
  const threads = ghJson(
    "api", "graphql", "-f", `query=${query}`,
    "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${number}`,
  ).data.repository.pullRequest.reviewThreads.nodes

  return {
    number,
    url: pr.url,
    state: pr.state,
    isDraft: pr.isDraft,
    baseRefName: pr.baseRefName,
    mergeStateStatus: pr.mergeStateStatus,
    reviewDecision: pr.reviewDecision,
    unresolvedThreads: threads.filter((t) => !t.isResolved).length,
    checks: (pr.statusCheckRollup ?? []).map((c) => ({
      name: c.name ?? c.context,
      conclusion: (c.conclusion ?? c.state ?? "").toUpperCase(),
    })),
    // `reviews` is chronological; the last one per author is what counts, which
    // is how a dismissed or superseded approval stops counting.
    reviews: Object.values(
      (pr.reviews ?? []).reduce((latest, review) => {
        if (review.state === "COMMENTED") return latest
        latest[review.author.login] = { author: review.author.login, state: review.state }
        return latest
      }, /** @type {Record<string, {author:string,state:string}>} */ ({})),
    ),
  }
}

// ---------------------------------------------------------------------------
// Release-run facts.
// ---------------------------------------------------------------------------

const tagExists = (repo, tag) =>
  git("ls-remote", "--tags", "origin", `refs/tags/${tag}`).trim().length > 0

function releaseRun(repo, tag) {
  const runs = ghJson(
    "api", `repos/${repo}/actions/runs?event=workflow_dispatch&per_page=30`,
    "--jq", "[.workflow_runs[] | {id,head_branch,status,conclusion,name,html_url}]",
  )
  return runs.find((r) => r.name === "Release" && r.head_branch === tag) ?? null
}

function pendingDeployment(repo, runId) {
  const pending = ghJsonAs(APPROVER, "api", `repos/${repo}/actions/runs/${runId}/pending_deployments`)
  return pending.find((d) => d.environment?.name === ENVIRONMENT && d.current_user_can_approve) ?? null
}

/** Both packages, at this exact version, as the registry sees them. */
async function publishedToNpm(version) {
  const results = []
  for (const name of PACKAGES) {
    try {
      const response = await fetch(`https://registry.npmjs.org/${name}`, {
        headers: { accept: "application/vnd.npm.install-v1+json" },
      })
      if (!response.ok) { results.push({ name, published: false, why: `registry answered ${response.status}` }); continue }
      const body = await response.json()
      results.push({ name, published: Boolean(body.versions?.[version]) })
    } catch (error) {
      results.push({ name, published: false, why: String(error?.message ?? error) })
    }
  }
  return results
}

const githubReleaseExists = (repo, tag) => {
  try {
    gh("release", "view", tag, "--repo", repo, "--json", "tagName")
    return true
  } catch {
    return false
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Poll until `check` returns something truthy. Reports what it is waiting for
 * rather than sitting silent, because these waits are minutes long.
 */
async function waitFor(label, check, { timeoutMs, intervalMs = 15_000 }) {
  const deadline = Date.now() + timeoutMs
  let announced = false
  for (;;) {
    const result = await check()
    if (result) return result
    if (Date.now() > deadline) return null
    if (!announced) { say(`  waiting for ${label} (up to ${Math.round(timeoutMs / 60_000)} min)…`); announced = true }
    await sleep(intervalMs)
  }
}

// ---------------------------------------------------------------------------
// Reporting.
// ---------------------------------------------------------------------------

async function gatherState(repo, version) {
  const tag = `v${version}`
  const branch = `release/${tag}`
  const pr = findPullRequest(repo, branch)
  const tagged = tagExists(repo, tag)
  const run = tagged ? releaseRun(repo, tag) : null
  const pending = run ? pendingDeployment(repo, run.id) : null
  const npm = await publishedToNpm(version)
  const release = githubReleaseExists(repo, tag)
  const published = npm.every((p) => p.published) && release

  return {
    version, tag, branch, pr, tagged, run, pending, npm, release, published,
    state: deriveState({
      published,
      pendingDeployment: Boolean(pending),
      deploymentApproved: Boolean(run && !pending && run.status !== "completed"),
      tagExists: tagged,
      pr: pr
        ? {
            state: pr.state,
            approvedByApprover:
              pr.state === "OPEN" &&
              pullRequestFacts(repo, pr.number).reviews.some(
                (r) => r.author === APPROVER && r.state === "APPROVED",
              ),
          }
        : null,
    }),
  }
}

function report(snapshot) {
  say("")
  say(`  version   ${snapshot.version}`)
  say(`  state     ${snapshot.state}`)
  say(`  branch    ${snapshot.branch}`)
  say(`  pull req  ${snapshot.pr ? `#${snapshot.pr.number} (${snapshot.pr.state})` : "none"}`)
  say(`  tag       ${snapshot.tagged ? snapshot.tag : "not created"}`)
  say(`  release   ${snapshot.run ? `${snapshot.run.status}/${snapshot.run.conclusion ?? "-"}  ${snapshot.run.html_url}` : "not dispatched"}`)
  for (const pkg of snapshot.npm) say(`  npm       ${pkg.name}@${snapshot.version}: ${pkg.published ? "published" : `not published${pkg.why ? ` (${pkg.why})` : ""}`}`)
  say(`  gh release ${snapshot.release ? snapshot.tag : "none"}`)
  say("")
}

// ---------------------------------------------------------------------------
// prepare
// ---------------------------------------------------------------------------

function commandPrepare(repo, { version, mode }) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) fail("--version must be a plain semantic version, e.g. 0.2.2")
  preflight(repo)

  const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8")
  if (!changelogHasDatedSection(changelog, version)) {
    fail(
      `CHANGELOG.md has no dated "## [${version}]" section.\n` +
      `  Release notes are written by a person, not generated. Add the section, then run prepare again.`,
    )
  }

  // The CURRENT sources must agree before anything is written. A bump applied
  // on top of an already-inconsistent tree hides which file was wrong.
  say("  checking the current version sources agree…")
  run("node", ["scripts/release-version-sync.mjs"])

  git("fetch", "origin", "--quiet")
  const branch = `release/v${version}`
  const existing = git("branch", "--list", branch)
  if (existing) git("checkout", "--quiet", branch)
  else git("checkout", "--quiet", "-b", branch, "origin/main")

  // ONE OWNER FOR THE VERSION, AND THIS IS NOT IT.
  //
  // `release-version-sync.mjs` knows every file that carries the release
  // number and how each one stores it: the runtime constant, both published
  // manifests, the root manifest, both lockfile mirrors, and the derived
  // template it regenerates afterwards. This step calls it and checks what it
  // did. It does NOT parse or rewrite a manifest itself — a second
  // implementation of "where the version lives" is a second thing to forget a
  // file, which is exactly how the root manifest came to be missed.
  say(`  setting every version source to ${version}…`)
  run("node", ["scripts/release-version-sync.mjs", "--set", version])

  // VERIFIED THROUGH THE SAME OWNER. `readVersions()` is that script's own
  // reader, imported rather than re-derived, so a source added there is checked
  // here without this file being edited at all.
  run("node", ["scripts/release-version-sync.mjs"])
  const sources = readVersions()
  const disagreeing = sources.filter((source) => source.version !== version)
  if (disagreeing.length > 0) {
    for (const source of disagreeing) say(`    ${source.path} reads ${source.version ?? "nothing"}`)
    fail(`${disagreeing.length} version source(s) do not read ${version} after the sync`)
  }
  say(`  all ${sources.length} committed version sources agree at ${version}`)

  if (git("status", "--porcelain")) {
    git("commit", "-am", `Prepare FlowCMS ${version}`)
    say(`  committed the version bump`)
  } else {
    say("  version sources were already at the target; nothing to commit")
  }
  git("push", "--quiet", "-u", "origin", branch)

  const previousTag = previousReleaseTag()
  const changedFiles = previousTag
    ? git("diff", "--name-only", `${previousTag}...HEAD`).split("\n").map((l) => l.trim()).filter(Boolean)
    : []
  const prediction = predictFastEligibility({
    mode, version, previousTag, changedFiles,
    versionOnlyManifests: VERSION_MANIFESTS.filter((p) => changedFiles.includes(p)),
  })

  let pr = findPullRequest(repo, branch)
  if (pr) say(`  pull request #${pr.number} already exists; reusing it`)
  else {
    const url = gh(
      "pr", "create", "--repo", repo, "--base", "main", "--head", branch,
      "--title", `Release FlowCMS ${version}`,
      "--body",
      `Prepared by \`scripts/release-orchestrate.mjs\`.\n\n` +
        `Requested path: **${mode}**${mode === "fast" ? (prediction.eligible ? " (eligible)" : " — NOT eligible, see below") : ""}\n\n` +
        (mode === "fast" && !prediction.eligible
          ? `The fast path was requested but does not apply:\n\n${prediction.reasons.map((r) => `- ${r}`).join("\n")}\n\n`
          : "") +
        `Merging this pull request cuts the release: \`release-on-merge.yml\` tags it and dispatches \`release.yml\`.\n`,
    )
    say(`  opened ${url}`)
    pr = findPullRequest(repo, branch)
  }

  say("")
  if (mode === "fast" && !prediction.eligible) {
    say("  FAST WAS REQUESTED BUT DOES NOT APPLY:")
    for (const reason of prediction.reasons) say(`    - ${reason}`)
    say(`  The release will take the FULL path. Re-run publish with --mode full, or accept it.`)
  } else if (mode === "fast") {
    say("  fast path is eligible; the merge commit will carry the Release-Path trailer")
  } else {
    say("  full path")
  }
  say(`\n  Next:  node scripts/release-orchestrate.mjs publish --confirm "${CONFIRMATION}"\n`)
}

// ---------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------

async function commandPublish(repo, { confirm, mode, pauseBeforeDeploy }) {
  if (confirm !== CONFIRMATION) {
    fail(
      `publish requires --confirm "${CONFIRMATION}".\n` +
      `  A pull request existing, and its checks passing, is not an instruction to publish.`,
    )
  }
  preflight(repo)

  const version = currentVersion()
  if (!version) fail("cannot read FLOWCMS_VERSION from the tree")
  const snapshot = await gatherState(repo, version)
  report(snapshot)

  if (snapshot.state === "PUBLISHED") { say("  already published; nothing to do."); return }
  if (snapshot.state === "IDLE") fail(`no pull request for ${snapshot.branch}. Run prepare first.`)

  const checks = requiredChecks(repo)
  const tag = snapshot.tag

  // -- approve ------------------------------------------------------------
  if (snapshot.pr && snapshot.pr.state === "OPEN") {
    const facts = pullRequestFacts(repo, snapshot.pr.number)
    if (facts.baseRefName !== "main") fail(`pull request #${facts.number} targets ${facts.baseRefName}, not main`)

    const alreadyApproved = facts.reviews.some((r) => r.author === APPROVER && r.state === "APPROVED")
    if (alreadyApproved) say(`  #${facts.number} already carries an APPROVED review from ${APPROVER}`)
    else {
      const gate = approvalGate(facts, checks)
      if (!gate.ok) { for (const b of gate.blockers) say(`    - ${b}`); fail("the pull request is not ready to approve") }
      say(`  approving #${facts.number} as ${APPROVER}…`)
      ghAs(APPROVER, "pr", "review", String(facts.number), "--repo", repo, "--approve",
        "--body", `Release ${version}: required checks green, no unresolved threads.`)
    }

    // -- merge ------------------------------------------------------------
    const afterApproval = pullRequestFacts(repo, snapshot.pr.number)
    const gate = mergeGate(afterApproval, afterApproval.reviews, checks)
    if (!gate.ok) { for (const b of gate.blockers) say(`    - ${b}`); fail("the pull request is not ready to merge") }

    say(`  merging #${afterApproval.number} as ${APPROVER} (${mode} path)…`)
    ghAs(APPROVER, "pr", "merge", String(afterApproval.number), "--repo", repo, "--merge",
      "--subject", `Merge pull request #${afterApproval.number} from ${repo.split("/")[0]}/${snapshot.branch}`,
      "--body", mergeBody(version, mode))
    say("  merged")
  }

  // -- the existing automation takes over ---------------------------------
  const tagged = await waitFor(`${tag} to be created by release-on-merge.yml`,
    async () => tagExists(repo, tag), { timeoutMs: 5 * 60_000, intervalMs: 10_000 })
  if (!tagged) fail(`${tag} was not created within 5 minutes. Check the "Release on merge" run.`)
  say(`  ${tag} exists`)

  const run = await waitFor("release.yml to start",
    async () => releaseRun(repo, tag), { timeoutMs: 5 * 60_000, intervalMs: 10_000 })
  if (!run) fail("no Release run appeared for the tag")
  say(`  release run ${run.id}: ${run.html_url}`)

  const pending = await waitFor(`the proof tiers, then the ${ENVIRONMENT} gate`,
    async () => pendingDeployment(repo, run.id), { timeoutMs: 45 * 60_000, intervalMs: 20_000 })
  if (!pending) {
    const now = releaseRun(repo, tag)
    fail(`no pending ${ENVIRONMENT} deployment appeared. Run is ${now?.status}/${now?.conclusion}. Nothing was published.`)
  }

  if (pauseBeforeDeploy) {
    say(`\n  PAUSED before approving the deployment, as asked.`)
    say(`  Re-run publish without --pause-before-deploy to release it.\n`)
    return
  }

  // -- the irreversible step ----------------------------------------------
  say(`  approving the ${ENVIRONMENT} deployment as ${APPROVER}…`)
  ghAs(APPROVER, "api", `repos/${repo}/actions/runs/${run.id}/pending_deployments`,
    "-f", "state=approved", "-f", `comment=Release ${version}, approved by the release orchestrator.`,
    "-F", `environment_ids[]=${pending.environment.id}`)
  say("  approved; npm publish is running")

  const finished = await waitFor("the publish job to finish",
    async () => { const r = releaseRun(repo, tag); return r?.status === "completed" ? r : null },
    { timeoutMs: 20 * 60_000, intervalMs: 15_000 })
  if (!finished) fail("the release run did not finish in time; check it before re-running")
  if (finished.conclusion !== "success") fail(`the release run concluded ${finished.conclusion}. See ${finished.html_url}`)

  // -- verify --------------------------------------------------------------
  say("  verifying the registry and the GitHub Release…")
  const verified = await waitFor("npm to serve both packages",
    async () => { const npm = await publishedToNpm(version); return npm.every((p) => p.published) ? npm : null },
    { timeoutMs: 10 * 60_000, intervalMs: 20_000 })
  if (!verified) fail(`npm does not serve ${version} for both packages yet. The publish may still be propagating.`)
  for (const pkg of verified) say(`    ${pkg.name}@${version} published`)

  if (!githubReleaseExists(repo, tag)) fail(`${tag} published to npm but has no GitHub Release`)
  say(`    GitHub Release ${tag} exists`)
  say(`\n  PUBLISHED: FlowCMS ${version}\n`)
}

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const value = (flag) => { const i = argv.indexOf(flag); return i === -1 ? null : argv[i + 1] }
  return {
    command: argv[0],
    version: value("--version"),
    mode: value("--mode") ?? "full",
    confirm: value("--confirm"),
    pauseBeforeDeploy: argv.includes("--pause-before-deploy"),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const repo = repoSlug()

  if (!["fast", "full"].includes(args.mode)) fail("--mode must be fast or full")

  switch (args.command) {
    case "prepare":
      return commandPrepare(repo, args)
    case "status": {
      const version = args.version ?? currentVersion()
      preflight(repo)
      report(await gatherState(repo, version))
      return
    }
    case "publish":
      return commandPublish(repo, args)
    default:
      say(readFileSync(fileURLToPath(import.meta.url), "utf8").split("Usage:")[1].split("*/")[0].replace(/^\s*\*/gm, ""))
      process.exit(args.command ? 1 : 0)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => fail(error?.message ?? String(error)))
}
