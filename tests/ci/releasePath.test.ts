import { describe, expect, it } from "vitest"
import {
  FAST_ELIGIBLE,
  FAST_TRAILER,
  NEVER_FAST,
  VERSION_MANIFESTS,
  classifyPath,
  decideReleasePath,
  isPatchBump,
  needsDeepProof,
} from "../../scripts/ci/decide-release-path.mjs"

/**
 * THE FAST PATCH RELEASE, PINNED.
 *
 * `scripts/ci/decide-release-path.mjs` decides whether a merge to `main` gets
 * the full 15-20 minute proof or the CI tier alone. It is the only thing
 * standing between "this looked like a small change" and a version reaching npm
 * without the database matrix, the consumer proofs, the Docker tier or the
 * portability tier having run.
 *
 * So the assertions worth making here are almost all about REFUSAL. The
 * question a test can usefully answer about this file is not "does it go fast
 * when it should" — that is one case — but "does every way of being wrong end
 * up on the full path", which is many, and which is where a regression would
 * actually cost something.
 *
 * The decision function is pure by design: every git fact it needs arrives as
 * an argument. That is what makes these cases writable at all.
 */

/** A merge that qualifies on every count, as the baseline to perturb. */
const QUALIFYING = {
  version: "0.2.2",
  previousTag: "v0.2.1",
  commitMessage: "Fix the typo in the setup wizard's second step\n\nRelease-Path: fast\n",
  changedFiles: [
    "src/Modules/Setup/wizard.tsx",
    "CHANGELOG.md",
    "src/Themes/contract/version.ts",
    "packages/flowcms/package.json",
    "packages/create-flowcms/package.json",
  ],
  versionOnlyManifests: VERSION_MANIFESTS,
}

describe("the baseline", () => {
  it("takes the fast path when all three conditions hold", () => {
    const { fast, blockers } = decideReleasePath(QUALIFYING)
    expect(blockers).toEqual([])
    expect(fast).toBe(true)
  })
})

describe("the opt-in", () => {
  it("refuses without the trailer, however small the diff", () => {
    const { fast, blockers } = decideReleasePath({
      ...QUALIFYING,
      commitMessage: "Fix the typo in the setup wizard's second step\n",
    })
    expect(fast).toBe(false)
    expect(blockers.join("\n")).toMatch(/Release-Path: fast/)
  })

  it("does not read the trailer out of prose", () => {
    /**
     * THE FAILURE THIS PREVENTS. This repository writes long commit messages
     * that explain their own mechanisms, and a commit describing the fast path
     * will quote the trailer. Quoted mid-sentence it must not opt anything in;
     * only trailer position counts.
     */
    const prose =
      "Explain the release paths\n\n" +
      "A maintainer adds Release-Path: fast to the merge commit when the change " +
      "cannot reach what the deep tiers cover.\n"
    expect(FAST_TRAILER.test(prose)).toBe(false)
    expect(decideReleasePath({ ...QUALIFYING, commitMessage: prose }).fast).toBe(false)
  })

  it("accepts the trailer among other trailers", () => {
    const message =
      "Fix the redirect target\n\n" +
      "Release-Path: fast\n" +
      "Co-Authored-By: Somebody <nobody@example.com>\n"
    expect(decideReleasePath({ ...QUALIFYING, commitMessage: message }).fast).toBe(true)
  })

  it("does not accept a trailer asking for anything else", () => {
    for (const value of ["Release-Path: full", "Release-Path: quick", "Release-Path:"]) {
      expect(
        decideReleasePath({ ...QUALIFYING, commitMessage: `Subject\n\n${value}\n` }).fast,
        `${value} opted a release into the fast path`,
      ).toBe(false)
    }
  })
})

describe("the bump", () => {
  it("accepts exactly one patch step", () => {
    expect(isPatchBump("0.2.1", "0.2.2")).toBe(true)
    expect(isPatchBump("1.0.0", "1.0.1")).toBe(true)
  })

  it("refuses a minor or major bump", () => {
    /**
     * A minor bump is the release that WITHDRAWS the claim "the surface did not
     * change". It is exactly the case the deep tiers exist for, so no trailer
     * may buy it a shallow proof.
     */
    expect(isPatchBump("0.2.1", "0.3.0")).toBe(false)
    expect(isPatchBump("0.2.1", "1.0.0")).toBe(false)
    const { fast, blockers } = decideReleasePath({ ...QUALIFYING, version: "0.3.0" })
    expect(fast).toBe(false)
    expect(blockers.join("\n")).toMatch(/not a patch bump/)
  })

  it("refuses a skipped patch, a downgrade and a repeat", () => {
    expect(isPatchBump("0.2.1", "0.2.3")).toBe(false)
    expect(isPatchBump("0.2.1", "0.2.0")).toBe(false)
    expect(isPatchBump("0.2.1", "0.2.1")).toBe(false)
  })

  it("refuses anything it cannot read as a plain semantic version", () => {
    // A prerelease is not a patch bump this file knows how to reason about, so
    // it declines rather than guessing.
    expect(isPatchBump("0.2.1", "0.2.2-rc.1")).toBe(false)
    expect(isPatchBump("v0.2.1", "0.2.2")).toBe(false)
    expect(isPatchBump("", "0.2.2")).toBe(false)
    expect(isPatchBump(undefined, "0.2.2")).toBe(false)
  })

  it("refuses when there is no previous tag to measure against", () => {
    const { fast, blockers } = decideReleasePath({ ...QUALIFYING, previousTag: null })
    expect(fast).toBe(false)
    expect(blockers.join("\n")).toMatch(/no previous release tag/)
  })
})

describe("the diff", () => {
  it("allows the source, the tests, the docs and the changelog", () => {
    for (const path of [
      "src/Modules/Pages/actions.ts",
      "src/app/(admin)/layout.tsx",
      "tests/setup/setupRoute.test.ts",
      "docs/ci.md",
      "public/favicon.ico",
      "CHANGELOG.md",
      "README.md",
    ]) {
      expect(classifyPath(path).eligible, `${path} was refused`).toBe(true)
    }
  })

  it("refuses every path whose proof lives in a tier the fast path skips", () => {
    /**
     * Each of these is a real coupling, not a category. A schema change is
     * proved by the four-engine matrix; a script change by the consumer proofs;
     * a Dockerfile change by the image build; a lockfile change by every tier
     * that installs. Losing one of these entries is how a fast release ships
     * something nothing looked at.
     */
    for (const path of [
      ".github/workflows/release.yml",
      "scripts/build-create-flowcms.mjs",
      "src/db/schema.ts",
      "drizzle.config.postgresql.ts",
      "Dockerfile",
      ".dockerignore",
      "docker/entrypoint.sh",
      "compose.postgres.yml",
      "package.json",
      "package-lock.json",
      "bun.lock",
      "next.config.ts",
      "tsconfig.json",
      "vitest.config.ts",
      "eslint.config.mjs",
      "postcss.config.mjs",
      "components.json",
      "packages/flowcms/src/theme.ts",
      "packages/create-flowcms/src/index.ts",
      "packages/flowcms-theme-aurora/theme.json",
    ]) {
      expect(classifyPath(path).eligible, `${path} was allowed onto the fast path`).toBe(false)
    }
  })

  it("fails closed on a path it has never heard of", () => {
    /**
     * THE DIRECTION THE MISTAKE HAS TO FALL IN. A new top-level directory, a
     * new config file, a new packaging input: the fast path stops offering
     * itself until somebody decides the CI tier really does cover it. A
     * denylist would have published it unproven instead.
     */
    for (const path of ["terraform/main.tf", "renovate.json", ".npmrc", "some-new-dir/thing.ts"]) {
      const verdict = classifyPath(path)
      expect(verdict.eligible, `${path} defaulted to eligible`).toBe(false)
      expect(verdict.why).toMatch(/matches nothing/)
    }
  })

  it("allows a version manifest only when its diff is the version line", () => {
    for (const manifest of VERSION_MANIFESTS) {
      expect(classifyPath(manifest, VERSION_MANIFESTS).eligible, `${manifest} version-only`).toBe(
        true,
      )
      const withOtherChanges = classifyPath(manifest, [])
      expect(withOtherChanges.eligible, `${manifest} with a non-version change`).toBe(false)
      expect(withOtherChanges.why).toMatch(/beyond its version line/)
    }
  })

  it("refuses a dependency added alongside the version bump", () => {
    /**
     * The concrete case the version-only rule exists for: `packages/flowcms`
     * matches a NEVER_FAST pattern, and is readmitted only by being a
     * version-only diff. A dependency added in the same commit takes it out of
     * that set and back onto the full path.
     */
    const { fast, blockers } = decideReleasePath({
      ...QUALIFYING,
      versionOnlyManifests: VERSION_MANIFESTS.filter(
        (path) => path !== "packages/flowcms/package.json",
      ),
    })
    expect(fast).toBe(false)
    expect(blockers.join("\n")).toMatch(/packages\/flowcms\/package\.json/)
  })

  it("refuses an empty diff rather than reading it as a small one", () => {
    const { fast, blockers } = decideReleasePath({ ...QUALIFYING, changedFiles: [] })
    expect(fast).toBe(false)
    expect(blockers.join("\n")).toMatch(/no changed file/)
  })
})

describe("the report", () => {
  it("names every reason at once, not the first one", () => {
    /**
     * A maintainer who typed the trailer on a minor bump that also touches the
     * Dockerfile learns both things now, rather than one release attempt at a
     * time.
     */
    const { fast, blockers } = decideReleasePath({
      version: "0.3.0",
      previousTag: "v0.2.1",
      commitMessage: "Subject\n\nRelease-Path: fast\n",
      changedFiles: ["Dockerfile", "package-lock.json", "src/app/page.tsx"],
      versionOnlyManifests: [],
    })
    expect(fast).toBe(false)
    expect(blockers.length).toBeGreaterThanOrEqual(3)
    expect(blockers.join("\n")).toMatch(/not a patch bump/)
    expect(blockers.join("\n")).toMatch(/Dockerfile/)
    expect(blockers.join("\n")).toMatch(/package-lock\.json/)
  })
})

describe("the shared question both callers ask", () => {
  /**
   * `needsDeepProof` is the one place the allowlist is consulted. The fast
   * release path uses it as the third of its three conditions; portability.yml's
   * `changes` job uses it to decide whether a pull request pays for the Windows
   * and macOS suites.
   *
   * The property worth pinning is that they cannot drift: the same diff has to
   * produce the same verdict on both sides, because a second copy of this list
   * that disagreed about `src/db/` is the whole failure being designed against.
   */
  it("says deep for exactly the diffs the release path refuses", () => {
    const diffs = [
      ["src/app/page.tsx", "CHANGELOG.md"],
      ["src/db/schema.ts"],
      ["Dockerfile"],
      [".github/workflows/ci.yml"],
      ["docs/ci.md", "README.md"],
      ["terraform/main.tf"],
      ["scripts/build-package.mjs"],
    ]

    for (const changedFiles of diffs) {
      const { deep } = needsDeepProof(changedFiles)
      // The release path with everything else satisfied: whatever remains is
      // the diff verdict, so the two must agree.
      const { fast } = decideReleasePath({
        version: "0.2.2",
        previousTag: "v0.2.1",
        commitMessage: "Subject\n\nRelease-Path: fast\n",
        changedFiles,
        versionOnlyManifests: [],
      })
      expect(deep, `${changedFiles.join(", ")}: the two callers disagree`).toBe(!fast)
    }
  })

  it("lets a small src change skip the portability legs", () => {
    // The decision the fast PR gate exists to make. `src/` is proved by the
    // Linux vitest suite and the typecheck, both in the CI tier.
    expect(needsDeepProof(["src/Modules/Pages/actions.ts"]).deep).toBe(false)
    expect(needsDeepProof(["src/app/page.tsx", "tests/seo/sitemap.test.ts"]).deep).toBe(false)
  })

  it("says deep for an empty diff", () => {
    /**
     * FAIL CLOSED. An empty diff is what a shallow checkout, a bad base ref or
     * a broken range produces, and none of those mean "nothing changed". The
     * portability legs run rather than being skipped on an unread diff.
     */
    const { deep, reasons } = needsDeepProof([])
    expect(deep).toBe(true)
    expect(reasons.join("\n")).toMatch(/no changed file/)
  })

  it("says deep as soon as one path in an otherwise small diff needs it", () => {
    const { deep, reasons } = needsDeepProof([
      "src/app/page.tsx",
      "docs/ci.md",
      "src/db/schema.ts",
    ])
    expect(deep).toBe(true)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatch(/src\/db\/schema\.ts/)
  })

  it("honours the version-only exception the release path relies on", () => {
    expect(needsDeepProof(VERSION_MANIFESTS, VERSION_MANIFESTS).deep).toBe(false)
    expect(needsDeepProof(VERSION_MANIFESTS, []).deep).toBe(true)
  })
})

describe("the lists themselves", () => {
  it("checks the deny list before the allow list", () => {
    /**
     * `src/db/` is inside `src/`, and `src/` is fast-eligible. The whole
     * database matrix hangs on the deny being consulted first, so this asserts
     * the ordering through its one overlapping case rather than trusting the
     * source to keep it.
     */
    expect(FAST_ELIGIBLE.some((pattern) => pattern.test("src/db/schema.ts"))).toBe(true)
    expect(NEVER_FAST.some(({ pattern }) => pattern.test("src/db/schema.ts"))).toBe(true)
    expect(classifyPath("src/db/schema.ts").eligible).toBe(false)
  })

  it("names a tier for every path it refuses", () => {
    // The entry's `tier` is what a maintainer reads to understand why the fast
    // path was declined. An entry without one is a refusal nobody can act on.
    for (const entry of NEVER_FAST) {
      expect(entry.tier, `${entry.pattern} refuses without saying what covers it`).toBeTruthy()
    }
  })

  it("lists the same version manifests release-version-sync.mjs maintains", () => {
    // Two files deciding independently which manifests carry the version is how
    // one of them gets forgotten in a bump.
    expect([...VERSION_MANIFESTS].sort()).toEqual(
      [
        "packages/create-flowcms/package.json",
        "packages/flowcms/package.json",
        "src/Themes/contract/version.ts",
      ].sort(),
    )
  })
})
