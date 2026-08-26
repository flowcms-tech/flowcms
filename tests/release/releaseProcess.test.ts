/**
 * Release-process invariants.
 *
 * NOT version alignment — `tests/packaging/versionAlignment.test.ts` owns that,
 * and duplicating it here would give two answers to one question. This file
 * asserts the properties of the release *procedure*: that the publish guards
 * and the licence state agree with each other, that the release scripts cannot
 * perform a remote action, that the release tooling does not leak into
 * generated projects, and that the release workflow keeps the ordering which
 * outlives the guards.
 *
 * Scope narrowed in Phase 9.10E. The maintainer release documents moved into
 * the gitignored `dev-docs/`, and the assertions that policed their prose left
 * with them. What remains guards an ARTEFACT — a manifest, a guard script, a
 * workflow, or one of the public documents that can still make a claim about
 * publication — never a private sentence.
 *
 * Every assertion reads files. Nothing here builds, packs, publishes or spawns
 * anything, and nothing reaches a network.
 */

import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { EXCLUDE } from "../../scripts/lib/templateManifest.mjs"

// `process.cwd()`, matching tests/packaging and tests/scaffolder: vitest runs
// from the repository root and these suites already depend on that.
const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), "utf8")
const json = (p: string) => JSON.parse(read(p))

/** The two packages that are ever published. Aurora is a fixture and is not one. */
const PUBLISHABLE = ["packages/flowcms", "packages/create-flowcms"] as const

describe("publish guards", () => {
  it.each(PUBLISHABLE)("%s declares a real licence and is not private", (dir) => {
    const manifest = json(`${dir}/package.json`)

    // The guards and the licence are one state, not two. A package that has
    // chosen a licence but is still `private` is a release somebody stopped
    // halfway; a package that has dropped `private` while still saying
    // UNLICENSED is a release nobody may legally use.
    expect(manifest.license, `${dir} declares no usable licence`).not.toBe("UNLICENSED")
    expect(manifest.private, `${dir} is private — npm cannot publish it`).not.toBe(true)
    expect(manifest.scripts?.prepublishOnly).toBeTruthy()
    expect(existsSync(join(ROOT, dir, "publish-guard.mjs"))).toBe(true)
  })

  it.each(PUBLISHABLE)("%s's guard states its conditions and exits non-zero", (dir) => {
    const guardPath = `${dir}/publish-guard.mjs`
    if (!existsSync(join(ROOT, guardPath))) return // removed at the release commit, legitimately

    const guard = read(guardPath)
    // A guard that exits 0 is a guard that does nothing, and it fails in the
    // one direction nobody checks: the publish succeeds.
    expect(guard).toContain("process.exit(1)")
    // An empty condition list would make the guard an unexplained refusal,
    // which is the shape people delete rather than read.
    expect(guard).toMatch(/BLOCKERS\s*=\s*\[[\s\S]+?\S[\s\S]*?\]/)
    // Refusal is still the default. Only a real release lifts it, and the
    // checks run either way.
    expect(guard, `${dir}'s guard publishes without a release in progress`).toMatch(
      /FLOWCMS_RELEASE/,
    )
  })

  it("a root LICENSE file and an UNLICENSED manifest cannot coexist", () => {
    if (!existsSync(join(ROOT, "LICENSE"))) return

    for (const dir of PUBLISHABLE) {
      expect(
        json(`${dir}/package.json`).license,
        `${dir} still says UNLICENSED although a LICENSE file exists — the manifest is what tooling reads`,
      ).not.toBe("UNLICENSED")
    }
  })
})

describe("the changelog", () => {
  const changelog = read("CHANGELOG.md")

  it("keeps an Unreleased section", () => {
    expect(changelog).toMatch(/^## \[Unreleased\]/m)
  })

  it("does not date a version while the publish guards are armed", () => {
    const guarded = PUBLISHABLE.some((dir) => existsSync(join(ROOT, dir, "publish-guard.mjs")))
    if (!guarded) return

    // A dated heading is the universal signal that a version shipped. Writing
    // one before it did is how a changelog starts lying, and a changelog is
    // read precisely when somebody is deciding what they are running.
    const dated = changelog.match(/^## \[\d+\.\d+\.\d+\][^\n]*\d{4}-\d{2}-\d{2}/m)
    expect(dated, `"${dated?.[0]}" is dated, but nothing has been published`).toBeNull()
  })
})

describe("the release scripts", () => {
  const SCRIPTS = ["scripts/release-proof.mjs", "scripts/release-version-sync.mjs"]

  /**
   * Remote and irreversible operations. None of these belongs in a script that
   * runs unattended: the release procedure is a maintainer runbook and it is
   * performed by a person who can see what they are about to do.
   */
  const REMOTE = [
    ["git push", "pushing is a release step, not a proof step"],
    ["gh release", "creating a release is a human decision"],
    ["npm dist-tag", "retagging a published version is incident response"],
    ["npm deprecate", "same"],
    ["npm login", "a proof must never authenticate"],
    ["npm adduser", "same"],
  ] as const

  it.each(SCRIPTS)("%s performs no remote action", (script) => {
    const source = read(script)
    for (const [needle, why] of REMOTE) {
      expect(source, `${script} contains "${needle}" — ${why}`).not.toContain(needle)
    }
  })

  it("release-proof.mjs never publishes for real", () => {
    const source = read("scripts/release-proof.mjs")

    // Every `"publish"` in the stage table must sit in an argument list that
    // also carries --dry-run. The runtime assertion in the script is the real
    // guard; this catches the edit that removes it from the table.
    for (const match of source.matchAll(/\[npm, \[([^\]]*)\]/g)) {
      const args = match[1]
      if (!args.includes('"publish"')) continue
      expect(args, "a publish step in the stage table without --dry-run").toContain('"--dry-run"')
    }

    // The runtime refusal itself.
    expect(source).toContain("REFUSING")
  })

  it("release-proof.mjs only names scripts that exist", () => {
    const source = read("scripts/release-proof.mjs")
    const named = [...source.matchAll(/join\(ROOT, "scripts", "([^"]+)"\)/g)].map((m) => m[1])

    expect(named.length).toBeGreaterThan(0)
    for (const script of named) {
      // A release proof whose stages point at renamed scripts fails at the
      // moment it is needed most, with an error about a missing file rather
      // than about the artifact.
      expect(existsSync(join(ROOT, "scripts", script)), `scripts/${script} is missing`).toBe(true)
    }
  })

  it.each(SCRIPTS)("%s is kept out of generated projects", (script) => {
    // Release tooling for THIS repository. A generated site has no packages to
    // publish, no blockers register and no version sources of its own, so a
    // `release:*` script there is a command that either does nothing or reports
    // something meaningless about someone else's release.
    expect(
      EXCLUDE,
      `${script} must be listed in scripts/lib/templateManifest.mjs EXCLUDE — the scripts/ directory is copied whole`,
    ).toContain(script)
  })
})

/* -------------------------------------------------------------------------
 * What survives the release documents going private.
 *
 * Phase 9.10E moved `docs/release/**` into the gitignored `dev-docs/`, so the
 * assertions that policed those documents' prose moved out of the suite with
 * them. What stays here is everything that guards an ARTEFACT rather than a
 * sentence: the publish guards and release scripts above, and below, the
 * workflow ordering and the two public documents that can still make a claim
 * about publication.
 *
 * Nothing here reads a network, and nothing here proves the release works.
 * ---------------------------------------------------------------------- */

describe("provenance is never claimed", () => {
  const DOCS = ["docs/ci.md", "CHANGELOG.md"]

  /**
   * Wordings that assert an attestation exists. None can be true until a
   * publish has happened, and nothing has been published — so any of these is
   * either a lie or a document written ahead of the fact and left behind.
   *
   * Deliberately narrow. Conditional and prohibitive sentences ("if provenance
   * was used…", "nothing may claim provenance until…") are the correct way to
   * write about it and must keep passing.
   */
  const CLAIMS = [
    /provenance (?:is|was) (?:active|enabled|verified|confirmed|in place)/i,
    /provenance (?:is|was) working/i,
    /published with provenance\b(?![^.]*\b(?:until|unless|if|would|will|must|cannot|no document)\b)/i,
  ]

  it.each(DOCS)("%s claims no attestation that does not exist", (doc) => {
    const source = read(doc)
    for (const claim of CLAIMS) {
      expect(source, `${doc} asserts provenance as a fact: ${source.match(claim)?.[0]}`).not.toMatch(
        claim,
      )
    }
  })

  it("the workflow asserts the ordering that outlives the guards", () => {
    const workflow = read(".github/workflows/release.yml")
    // Not a fifth guard: PUBLISHING_BLOCKED is what refuses. This step is what
    // remains once that is deleted, and it must therefore be unconditional —
    // an `if:` on it would make it disappear exactly when it starts mattering.
    const at = workflow.indexOf("- name: RELEASE_PRECONDITIONS")
    expect(at, "release.yml has no RELEASE_PRECONDITIONS step").toBeGreaterThan(-1)
    const nextComment = workflow.indexOf("\n      #", at)
    const step = workflow.slice(at, nextComment > at ? nextComment : at + 1200)
    expect(step, "RELEASE_PRECONDITIONS is conditional and will vanish with the guards").not.toMatch(
      /^\s+if:/m,
    )
    expect(step, "it does not check repository visibility").toMatch(/repository\.private/)
    // Fails closed: an absent or unexpected value must not read as public.
    expect(step, "an unreadable visibility is treated as public").toMatch(/!= "false"/)
  })

  it("release.yml still triggers on a tag push, not on tag creation", () => {
    // Rescued from the publication-order suite. A tag created locally triggers
    // nothing; the push is the event. If this trigger is ever dropped, the
    // release gates stop being gates.
    const workflow = read(".github/workflows/release.yml")
    expect(workflow, "release.yml no longer triggers on a tag push").toMatch(/tags:\n\s*- "v\*"/)
  })
})

describe("public documents do not sell an unpublished package", () => {
  it.each(["CHANGELOG.md", "README.md", "docs/ci.md"])("%s", (doc) => {
    const guarded = PUBLISHABLE.some((dir) => existsSync(join(ROOT, dir, "publish-guard.mjs")))
    if (!guarded) return

    for (const line of read(doc).split("\n")) {
      const instruction = /^\s*(?:\$\s*)?(npx create-flowcms|npm install flowcms)\b/.test(line)
      expect(instruction, `${doc} instructs an install of an unpublished package: ${line.trim()}`).toBe(false)
    }
  })
})
