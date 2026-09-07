import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  APPROVER,
  AUTHOR,
  CONFIRMATION,
  approvalGate,
  changelogHasDatedSection,
  deriveState,
  mergeBody,
  mergeGate,
  predictFastEligibility,
} from "../../scripts/release-orchestrate.mjs"
import { FAST_TRAILER } from "../../scripts/ci/decide-release-path.mjs"

/**
 * THE RELEASE ORCHESTRATOR'S DECISIONS.
 *
 * `scripts/release-orchestrate.mjs` drives two identities through an
 * irreversible sequence: approve, merge, tag, publish. Everything it does that
 * cannot be undone is downstream of the four pure functions here, which is why
 * they are pure — the network half is a thin shell around these.
 *
 * As with the release-path suite, the assertions worth writing are about
 * REFUSAL. A gate that opens when it should is one case; a gate that opens when
 * it should not is a published version that cannot be recalled.
 */

/** A pull request with nothing wrong with it, as the baseline to break. */
const READY = {
  state: "OPEN",
  isDraft: false,
  // BLOCKED is the CORRECT state before an approval exists: main's ruleset is
  // holding it for the review we are about to submit.
  mergeStateStatus: "BLOCKED",
  unresolvedThreads: 0,
  checks: [
    { name: "CI gate", conclusion: "SUCCESS" },
    { name: "Portability gate", conclusion: "SUCCESS" },
  ],
}

const REQUIRED = ["CI gate", "Portability gate"] as const

describe("the gate before the approval", () => {
  it("opens for a pull request that is merely awaiting its review", () => {
    /**
     * THE BUG THIS PINS. Requiring `mergeStateStatus: CLEAN` here is the
     * obvious thing to write and it makes the whole tool inert: the ruleset
     * holds every pull request at BLOCKED until an approval exists, so the
     * approval could never be submitted and no release could ever be cut.
     */
    expect(approvalGate(READY, REQUIRED)).toEqual({ ok: true, blockers: [] })
  })

  it("refuses a failing or missing required check", () => {
    for (const checks of [
      [{ name: "CI gate", conclusion: "FAILURE" }, { name: "Portability gate", conclusion: "SUCCESS" }],
      [{ name: "CI gate", conclusion: "SUCCESS" }],
      [{ name: "CI gate", conclusion: "SUCCESS" }, { name: "Portability gate", conclusion: "" }],
    ]) {
      const gate = approvalGate({ ...READY, checks }, REQUIRED)
      expect(gate.ok, `${JSON.stringify(checks)} was approved`).toBe(false)
    }
  })

  it("refuses while any review thread is unresolved", () => {
    const gate = approvalGate({ ...READY, unresolvedThreads: 2 }, REQUIRED)
    expect(gate.ok).toBe(false)
    expect(gate.blockers.join("\n")).toMatch(/2 review thread\(s\) are unresolved/)
  })

  it("refuses a conflicted, stale, draft or closed pull request", () => {
    expect(approvalGate({ ...READY, mergeStateStatus: "DIRTY" }, REQUIRED).ok).toBe(false)
    // BEHIND matters twice over: the checks ran against something else, and the
    // fast-path prediction was computed against something else too.
    expect(approvalGate({ ...READY, mergeStateStatus: "BEHIND" }, REQUIRED).ok).toBe(false)
    expect(approvalGate({ ...READY, isDraft: true }, REQUIRED).ok).toBe(false)
    expect(approvalGate({ ...READY, state: "MERGED" }, REQUIRED).ok).toBe(false)
  })
})

describe("the gate before the merge", () => {
  const CLEAN = { ...READY, mergeStateStatus: "CLEAN" }
  const APPROVED = [{ author: APPROVER, state: "APPROVED" }]

  it("opens only once a real approval and a CLEAN verdict both exist", () => {
    expect(mergeGate(CLEAN, APPROVED, REQUIRED)).toEqual({ ok: true, blockers: [] })
  })

  it("refuses to merge past the ruleset, however privileged the account", () => {
    /**
     * `flowcms-tech` is a repository admin and CAN merge a BLOCKED pull request
     * — #13 was merged with no review at all. This is the refusal to use that
     * power: GitHub's own verdict has to be CLEAN.
     */
    const gate = mergeGate({ ...CLEAN, mergeStateStatus: "BLOCKED" }, APPROVED, REQUIRED)
    expect(gate.ok).toBe(false)
    expect(gate.blockers.join("\n")).toMatch(/refusing to merge past a rule/)
  })

  it("refuses without an approval from the approver specifically", () => {
    expect(mergeGate(CLEAN, [], REQUIRED).ok).toBe(false)
    // An approval from the author is not the code owner's approval.
    expect(mergeGate(CLEAN, [{ author: AUTHOR, state: "APPROVED" }], REQUIRED).ok).toBe(false)
  })

  it("refuses when the approver's latest review is not an approval", () => {
    // The caller reduces reviews to the LATEST per author, so a dismissed or
    // superseded approval arrives here as its replacement.
    for (const state of ["DISMISSED", "CHANGES_REQUESTED", "PENDING"]) {
      const gate = mergeGate(CLEAN, [{ author: APPROVER, state }], REQUIRED)
      expect(gate.ok, `a ${state} review counted as approval`).toBe(false)
    }
  })

  it("still enforces everything the approval gate did", () => {
    expect(mergeGate({ ...CLEAN, unresolvedThreads: 1 }, APPROVED, REQUIRED).ok).toBe(false)
    expect(
      mergeGate({ ...CLEAN, checks: [{ name: "CI gate", conclusion: "FAILURE" }] }, APPROVED, REQUIRED).ok,
    ).toBe(false)
  })
})

describe("the merge commit message", () => {
  it("carries the trailer for a fast release, where the classifier reads it", () => {
    /**
     * THE SILENT DEGRADATION THIS PREVENTS. `decide-release-path.mjs` reads the
     * trailer from `git log -1 HEAD` on main — the MERGE commit. Put it in a
     * branch commit instead and the release runs full while reporting nothing
     * unusual.
     */
    expect(FAST_TRAILER.test(mergeBody("0.2.2", "fast"))).toBe(true)
  })

  it("omits it for a full release", () => {
    expect(FAST_TRAILER.test(mergeBody("0.2.2", "full"))).toBe(false)
  })
})

describe("where the release has got to", () => {
  it("reports IDLE with nothing in flight", () => {
    expect(deriveState({})).toBe("IDLE")
  })

  it("walks the sequence in order", () => {
    expect(deriveState({ pr: { state: "OPEN" } })).toBe("PR_OPEN")
    expect(deriveState({ pr: { state: "OPEN", approvedByApprover: true } })).toBe("APPROVED")
    expect(deriveState({ pr: { state: "MERGED" } })).toBe("MERGED")
    expect(deriveState({ tagExists: true, pr: { state: "MERGED" } })).toBe("TAGGED")
    expect(deriveState({ pendingDeployment: true, tagExists: true })).toBe("AWAITING_APPROVAL")
    expect(deriveState({ deploymentApproved: true, tagExists: true })).toBe("PUBLISHING")
    expect(deriveState({ published: true, tagExists: true })).toBe("PUBLISHED")
  })

  it("lets the furthest fact win, so a resumed run rejoins where it left off", () => {
    /**
     * The property that makes an interrupted run safe to re-run: state is read
     * from the world, and the newest true thing decides. A stale pull request
     * record cannot drag a published release backwards into merging again.
     */
    expect(
      deriveState({ published: true, pendingDeployment: true, tagExists: true, pr: { state: "OPEN" } }),
    ).toBe("PUBLISHED")
    expect(
      deriveState({ pendingDeployment: true, tagExists: true, pr: { state: "OPEN" } }),
    ).toBe("AWAITING_APPROVAL")
  })
})

describe("the changelog precondition", () => {
  const dated = "# Changelog\n\n## [Unreleased]\n\n## [0.2.2] — 2026-09-08\n\n### Added\n"

  it("accepts a dated section for the target version", () => {
    expect(changelogHasDatedSection(dated, "0.2.2")).toBe(true)
  })

  it("refuses an undated one, which is what a half-written entry looks like", () => {
    expect(changelogHasDatedSection("## [0.2.2]\n\n### Added\n", "0.2.2")).toBe(false)
  })

  it("refuses when the section is for a different version", () => {
    expect(changelogHasDatedSection(dated, "0.2.3")).toBe(false)
    // The dots are escaped, so 0.2.2's section cannot satisfy 0X2X2.
    expect(changelogHasDatedSection(dated, "0X2X2")).toBe(false)
  })
})

describe("predicting whether the release will really be fast", () => {
  const BASE = {
    mode: "fast",
    version: "0.2.2",
    previousTag: "v0.2.1",
    changedFiles: ["src/app/page.tsx", "CHANGELOG.md"],
    versionOnlyManifests: [],
  }

  it("says eligible for a patch bump with a diff the CI tier covers", () => {
    expect(predictFastEligibility(BASE).eligible).toBe(true)
  })

  it("judges the whole diff since the previous tag, not just this change", () => {
    /**
     * THE SURPRISE THIS EXISTS TO PREVENT. The classifier runs on main after
     * the merge, over everything since the last release. An unrelated merge
     * that touched `scripts/` makes this release full however it is labelled —
     * and without this prediction you learn that from a workflow summary after
     * the tag already exists.
     */
    const { eligible, reasons } = predictFastEligibility({
      ...BASE,
      changedFiles: [...BASE.changedFiles, "scripts/build-package.mjs"],
    })
    expect(eligible).toBe(false)
    expect(reasons.join("\n")).toMatch(/scripts\/build-package\.mjs/)
  })

  it("refuses a bump that is not exactly one patch", () => {
    expect(predictFastEligibility({ ...BASE, version: "0.3.0" }).eligible).toBe(false)
    expect(predictFastEligibility({ ...BASE, previousTag: null }).eligible).toBe(false)
  })

  it("never claims eligibility when fast was not asked for", () => {
    expect(predictFastEligibility({ ...BASE, mode: "full" }).eligible).toBe(false)
  })
})

describe("the confirmation", () => {
  it("is the phrase release.yml already demands, not a second one", () => {
    /**
     * One phrase across the whole path. A second, different phrase would be one
     * more thing to get wrong at the only moment it matters.
     */
    const release = readFileSync(
      join(process.cwd(), ".github/workflows/release.yml"),
      "utf8",
    )
    expect(release).toContain(`inputs.confirm == '${CONFIRMATION}'`)
  })
})
