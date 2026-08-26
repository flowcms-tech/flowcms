import { describe, expect, it } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { FLOWCMS_VERSION } from "@/Framework/Config/version"
import { isCompatible } from "@/Themes/validation/compat"

/**
 * VERSION DRIFT, caught from source alone.
 *
 * FlowCMS carries the same release number in five places that are updated by
 * hand and by three different build scripts. They agree today; nothing so far
 * notices from *source* when they stop.
 *
 * `packageArtifact.test.ts` already asserts the built package reports the
 * version its manifest claims — but it reads `packages/flowcms/dist`, so it
 * only speaks after `npm run build:packages` has run, and `build-package.mjs`
 * refuses that build on a mismatch anyway. That is a good gate and a late one:
 * a version bump that touches four files and forgets the fifth should fail in
 * the unit suite, in a second, naming the file.
 *
 * This file therefore reads MANIFESTS AND SOURCE ONLY. It must not require a
 * build, a network, or a database.
 *
 *   src/Themes/contract/version.ts            FLOWCMS_VERSION  ← source of truth
 *   package.json                              the application
 *   packages/flowcms/package.json             the published theme API
 *   packages/flowcms-theme-aurora/            its compat range and peer range
 *   packages/create-flowcms/template.json     the template stamp (build output)
 *
 * See dev-docs/decisions/release-metadata.md, "Version relationships", for what
 * each number means and which of them a release bumps.
 */

const ROOT = process.cwd()
const read = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8"))
const readText = (path: string) => readFileSync(join(ROOT, path), "utf8")

const app = read("package.json")
const flowcms = read("packages/flowcms/package.json")
const createFlowcms = read("packages/create-flowcms/package.json")
const aurora = read("packages/flowcms-theme-aurora/package.json")

const SEMVER = /^\d+\.\d+\.\d+$/

describe("FLOWCMS_VERSION is the source of truth", () => {
  it("is a hardcoded string literal, not a value read at runtime", () => {
    // Deliberately not read from package.json: Next's tracer leaves behind a
    // JSON file nothing imports statically, and a compatibility check that
    // throws ENOENT in production and works in development is worse than none.
    // If this ever becomes an expression, the standalone build is the place it
    // will fail, and it will fail for an operator rather than here.
    const source = readText("src/Themes/contract/version.ts")
    const literal = source.match(/export const FLOWCMS_VERSION\s*=\s*"([^"]+)"/)?.[1]

    expect(literal, "FLOWCMS_VERSION must be a plain string literal").toBeDefined()
    expect(literal).toMatch(SEMVER)
    expect(literal).toBe(FLOWCMS_VERSION)
  })
})

describe("the numbers a release bumps together", () => {
  it("the published package version equals FLOWCMS_VERSION", () => {
    // They mean different things — one is what npm resolves, the other is what
    // a theme's flowcmsCompat range is evaluated against — but they describe
    // the same release. An artifact published under a number that disagrees
    // with the one it reports at runtime tells theme authors the wrong thing
    // about which FlowCMS they are compatible with, and the disagreement is
    // invisible until somebody's theme is refused.
    expect(flowcms.version, "packages/flowcms/package.json").toBe(FLOWCMS_VERSION)
  })

  it("the application version equals FLOWCMS_VERSION", () => {
    // The application IS FlowCMS. `src/Themes/contract/version.ts` says the
    // constant "must be kept in step with package.json's version field when
    // FlowCMS is released"; this is that sentence, enforced.
    //
    // If a release ever deliberately decouples these, delete this test in the
    // commit that decouples them and say why in dev-docs/decisions/release-metadata.md — do not
    // let it rot into a skipped assertion.
    expect(app.version, "package.json").toBe(FLOWCMS_VERSION)
  })
})

describe("the example theme still accepts the version it ships beside", () => {
  it("declares a flowcmsCompat range that admits FLOWCMS_VERSION", () => {
    // The failure this catches: bump FLOWCMS_VERSION to 0.2.0 and the shipped
    // example theme silently stops activating, because ^0.1.0 excludes 0.2.0
    // by the pre-1.0 caret rule. The symptom is a fixture that no longer
    // proves anything.
    const manifest = readText("packages/flowcms-theme-aurora/src/manifest.ts")
    const compat = manifest.match(/flowcmsCompat:\s*"([^"]+)"/)?.[1]

    expect(compat, "flowcmsCompat must be a literal in src/manifest.ts").toBeDefined()
    expect(isCompatible(compat as string, FLOWCMS_VERSION), `${compat} vs ${FLOWCMS_VERSION}`).toBe(true)
  })

  it("declares an npm peer range that admits FLOWCMS_VERSION", () => {
    // A second, independent number: `peerDependencies.flowcms` is what npm
    // resolves, `flowcmsCompat` is what FlowCMS evaluates. A theme whose peer
    // range and compat range disagree installs and then refuses to activate,
    // or activates against a package npm would not have installed.
    const peer: string = aurora.peerDependencies.flowcms
    expect(isCompatible(peer, FLOWCMS_VERSION), `${peer} vs ${FLOWCMS_VERSION}`).toBe(true)
  })
})

describe("the template stamp", () => {
  const stampPath = "packages/create-flowcms/template.json"

  it("records the FlowCMS version the template was generated from", () => {
    // `template.json` is BUILD OUTPUT and gitignored, written by
    // scripts/build-create-flowcms.mjs from src/Themes/contract/version.ts. It
    // is absent in a clean checkout, and a test that failed on its absence
    // would fail for every contributor who has not run the template build.
    //
    // When it IS present it must agree, because a stale stamp is how a
    // scaffolder ships last release's application while claiming this one.
    if (!existsSync(join(ROOT, stampPath))) {
      expect(true, "template not built in this checkout — nothing to compare").toBe(true)
      return
    }

    const stamp = read(stampPath)
    expect(stamp.templateVersion, stampPath).toBe(FLOWCMS_VERSION)
    expect(stamp.files, "the stamp must record a non-zero file count").toBeGreaterThan(0)
  })
})

describe("create-flowcms versions independently, on purpose", () => {
  it("carries a valid semver of its own", () => {
    // The scaffolder is a separate npm release: a CLI bug fix must be
    // publishable without pretending FlowCMS itself changed, and a FlowCMS
    // patch must not force a CLI republish. What ties a generated project to a
    // FlowCMS release is `template.json`'s templateVersion, checked above —
    // NOT this number.
    expect(createFlowcms.version).toMatch(SEMVER)
  })

  it("is named exactly `create-flowcms`, which is what `npm create flowcms` resolves", () => {
    // `npm create X` / `npm init X` / `yarn create X` all expand to the package
    // literally named `create-X`. Any other name — a scope, a suffix, a dash in
    // the wrong place — silently breaks the one invocation every document in
    // this repository tells people to type.
    expect(createFlowcms.name).toBe("create-flowcms")
    expect(createFlowcms.bin?.["create-flowcms"]).toBeTruthy()
  })
})

describe("publication is still blocked, in every package", () => {
  // packageMetadata.test.ts pins this for `flowcms`. The other two had no
  // manifest-level coverage at all, which is how a `private` flag goes missing
  // without a single test noticing.
  const guarded = [
    ["create-flowcms", createFlowcms, "packages/create-flowcms/publish-guard.mjs"],
    ["aurora", aurora, "packages/flowcms-theme-aurora/publish-guard.mjs"],
  ] as const

  for (const [name, manifest, guardPath] of guarded) {
    it(`${name} is private AND carries a prepublish guard that exits non-zero`, () => {
      expect(manifest.private, `${name}: private`).toBe(true)
      expect(manifest.scripts?.prepublishOnly, `${name}: prepublishOnly`).toBe(
        `node ./${guardPath.split("/").pop()}`,
      )
      expect(existsSync(join(ROOT, guardPath)), guardPath).toBe(true)
      expect(readText(guardPath)).toMatch(/process\.exit\(1\)/)
    })

    it(`${name} runs its guard on publish and NOT on pack`, () => {
      // Every packaging proof in this repository packs. A guard wired to
      // `prepack` would block the proofs and leave publishing open.
      expect(manifest.scripts?.prepack, `${name}: prepack`).toBeUndefined()
      expect(manifest.scripts?.prepare, `${name}: prepare`).toBeUndefined()
    })
  }

  it("every manifest declares the same chosen licence", () => {
    // Was three assertions on "UNLICENSED". Those guarded against inventing a
    // licence before one existed; the decision has since been made (Phase 9.1),
    // so they now guard the decision instead of its absence.
    //
    // All three are checked together on purpose. A repository whose root says
    // one thing and whose published packages say another is the shape that
    // produces an npm listing contradicting the LICENSE file beside it.
    for (const [name, manifest] of [
      ["flowcms", flowcms],
      ["create-flowcms", createFlowcms],
      ["flowcms-app (root)", app],
    ] as const) {
      expect(manifest.license, `${name}.license`).toBe("GPL-2.0-or-later")
    }
  })

  it("every publishable manifest carries the approved repository metadata", () => {
    // THIS TEST REPLACES ITS OWN INVERSE. It used to assert these fields were
    // still ABSENT, with a note saying it should be deleted in the same commit
    // that supplied the real values — because absent was deliberate, and a
    // plausible-looking wrong URL is worse than a missing one.
    //
    // The values were approved in Phase 9.1, so the guard is inverted rather
    // than deleted: the risk it was protecting against has not gone away, it has
    // changed shape. A typo'd or half-updated URL in an npm listing points
    // strangers at somebody else's page just as effectively as a guessed one.
    const REPO = "https://github.com/flowcms-tech/flowcms"

    for (const [name, manifest] of [
      ["flowcms", flowcms],
      ["create-flowcms", createFlowcms],
    ] as const) {
      expect(manifest.repository?.url, `${name}.repository.url`).toBe(`git+${REPO}.git`)
      expect(manifest.homepage, `${name}.homepage`).toBe(REPO)
      expect(manifest.bugs?.url, `${name}.bugs.url`).toBe(`${REPO}/issues`)
      expect(manifest.author, `${name}.author`).toBe("FlowCMS Tech")
    }
  })
})
