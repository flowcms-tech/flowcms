import { describe, expect, it } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

/**
 * WHAT FLOWCMS PUBLISHES, pinned.
 *
 * Phase 7.2 turned `flowcms/theme` from a path alias into a real package
 * subpath. The metadata below is the whole difference between an artifact a
 * stranger can install and one that only works in this repository, and every
 * field here has a specific failure attached to it.
 *
 * This file checks the MANIFESTS, which are cheap and deterministic. The
 * artifact itself is checked in `packageArtifact.test.ts`, and the end-to-end
 * proof — pack, install into a temp directory, typecheck, execute — is
 * `scripts/verify-package-consumer.mjs`, which is a script rather than a test
 * because it installs packages and the unit suite must not.
 */

const ROOT = process.cwd()
const read = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8"))

const app = read("package.json")
const flowcms = read("packages/flowcms/package.json")
const aurora = read("packages/flowcms-theme-aurora/package.json")

describe("the distribution model", () => {
  it("publishes ONE package, named flowcms", () => {
    // Option A of the Phase 7.2 design: there is exactly one public consumer
    // today (a theme author) and one public surface (the theme contract).
    // A second package would be fragmentation with no problem to solve.
    expect(flowcms.name).toBe("flowcms")
  })

  it("keeps the application separate from the package, by name", () => {
    // The repository root is the FlowCMS APPLICATION — what create-flowcms will
    // later emit as a project. It cannot also be called `flowcms`: npm refuses
    // to install a package under a package of the same name, so Aurora could
    // never resolve `flowcms/theme` from inside this repository.
    expect(app.name).toBe("flowcms-app")
    expect(app.name).not.toBe(flowcms.name)
  })

  it("keeps the application private", () => {
    // `npm publish` at the repository root must be impossible. The application
    // is not a library and its dependency list is not a public contract.
    expect(app.private).toBe(true)
  })
})

describe("publishing is deliberately blocked", () => {
  it("the package is private AND carries a prepublish guard", () => {
    // Two guards, because they fail differently. `private` is one word somebody
    // removes while tidying; the script says why it is there.
    expect(flowcms.private).toBe(true)
    expect(flowcms.scripts?.prepublishOnly).toBeTruthy()
    expect(existsSync(join(ROOT, "packages/flowcms/publish-guard.mjs"))).toBe(true)
  })

  it("the guard fails rather than warns", () => {
    const guard = readFileSync(join(ROOT, "packages/flowcms/publish-guard.mjs"), "utf8")
    expect(guard).toMatch(/process\.exit\(1\)/)
    // It must name the reason, not just refuse.
    expect(guard.toLowerCase()).toMatch(/licen[cs]e/)
  })

  it("runs on publish and NOT on pack", () => {
    // Every packaging proof in this repository packs. A guard wired to `prepack`
    // would block the proofs and leave publishing open, which is backwards.
    expect(flowcms.scripts?.prepack).toBeUndefined()
    expect(flowcms.scripts?.prepare).toBeUndefined()
  })

  it("declares the licence the project chose", () => {
    // Was `expect(license).toBe("UNLICENSED")`. That assertion existed to stop
    // anyone inventing a licence before one had been chosen, and it did its job
    // — it is not being relaxed, it is being pointed at the decision that has
    // since been made (Phase 9.1, dev-docs/decisions/license-decision.md §9).
    //
    // "or later" is the part that matters and the part a careless edit would
    // drop: TinyMCE is GPL-2.0-OR-LATER, and FlowCMS serves its assets, bakes
    // them into the image and ships them into every generated project. Bare
    // `GPL-2.0-only` would reopen a compatibility question this project has
    // closed, so the exact string is asserted rather than a family of them.
    expect(flowcms.license).toBe("GPL-2.0-or-later")
  })
})

describe("the package exports exactly one public subpath", () => {
  it("exposes ./theme and nothing else consumers can import", () => {
    expect(Object.keys(flowcms.exports).sort()).toEqual(["./package.json", "./theme"])
  })

  it("has NO root export", () => {
    // `import "flowcms"` must fail. FlowCMS is an application, not a library
    // consumers instantiate, and a root export would imply otherwise — and
    // invite the first person who wanted an internal to ask for it there.
    expect(flowcms.exports["."]).toBeUndefined()
  })

  it("points ./theme at built output, with types first", () => {
    const theme = flowcms.exports["./theme"]
    expect(theme.types).toBe("./dist/index.d.ts")
    expect(theme.default).toBe("./dist/index.js")
    // Raw TypeScript in a tarball would make every consumer transpile a
    // dependency, which most bundlers refuse to do by default.
    //
    // The negative lookbehind is load-bearing: `./dist/index.d.ts` ends in
    // `.ts` and is exactly what should be there, so the obvious `/\.tsx?$/`
    // fails on a correct manifest — which is how the first draft of this test
    // failed for a reason that had nothing to do with the package.
    for (const target of Object.values(theme) as string[]) {
      expect(target, target).not.toMatch(/(?<!\.d)\.tsx?$/)
      expect(target, target).not.toMatch(/^\.\/src\//)
    }
  })

  it("declares no legacy main/module/types fallback", () => {
    // A top-level `main` re-opens every deep path that `exports` closes: Node
    // and bundlers fall back to directory resolution when it is present.
    expect(flowcms.main).toBeUndefined()
    expect(flowcms.module).toBeUndefined()
    expect(flowcms.types).toBeUndefined()
  })
})

describe("module format and runtime policy", () => {
  it("is ESM only", () => {
    // No dual CJS build. Nothing in the consumer story needs `require`, and
    // dual packaging is a known source of duplicate-instance bugs — two copies
    // of the same module with different identities.
    expect(flowcms.type).toBe("module")
    expect(JSON.stringify(flowcms.exports)).not.toMatch(/require/)
    expect(flowcms.exports["./theme"].require).toBeUndefined()
  })

  it("declares the Node range FlowCMS is actually tested on", () => {
    // The production image is node:22. Claiming a lower floor would be claiming
    // something untested.
    expect(flowcms.engines.node).toBe(">=22")
  })

  it("declares itself side-effect free", () => {
    // True by construction: the contract is types, pure functions, a frozen
    // array and one component. It lets a bundler drop what a theme never uses.
    expect(flowcms.sideEffects).toBe(false)
  })
})

describe("the dependency model", () => {
  it("peers React rather than depending on it", () => {
    // A theme renders inside the host application's React. A second copy is how
    // you get two renderers and a hooks error nobody can explain.
    expect(flowcms.peerDependencies).toEqual({ react: "^19.0.0" })
    expect(flowcms.dependencies?.react).toBeUndefined()
    expect(flowcms.dependencies?.["react-dom"]).toBeUndefined()
  })

  it("depends on nothing but the two utilities `cn` needs", () => {
    // Every dependency here is one a theme author installs transitively. The
    // list is short because the contract is a leaf.
    expect(Object.keys(flowcms.dependencies).sort()).toEqual(["clsx", "tailwind-merge"])
  })

  it("does not depend on Next.js", () => {
    // `flowcms/theme` exposes nothing that needs Next at runtime. A theme that
    // had to import `next/*` would stop being an ordinary React package, and
    // asset and routing handling would leak out of the host where they belong.
    const all = { ...flowcms.dependencies, ...flowcms.peerDependencies, ...flowcms.devDependencies }
    expect(Object.keys(all).filter((name) => name === "next" || name.startsWith("next/"))).toEqual([])
  })

  it("does not depend on the database, validation or server layers", () => {
    // The whole point of making the contract a leaf. If any of these appeared,
    // a theme author's `npm install` would pull FlowCMS's server stack.
    const all = Object.keys({ ...flowcms.dependencies, ...flowcms.peerDependencies })
    for (const forbidden of ["drizzle-orm", "zod", "@libsql/client", "server-only", "postgres", "mysql2"]) {
      expect(all, forbidden).not.toContain(forbidden)
    }
  })
})

describe("the publish allowlist", () => {
  it("uses `files` rather than relying on .npmignore", () => {
    // An allowlist is a decision about what ships; an ignore list is a denial
    // of the things somebody remembered. This repository contains a developer's
    // .env, a SQLite database, Docker state and internal notes.
    expect(flowcms.files).toEqual(["dist", "README.md"])
    expect(existsSync(join(ROOT, "packages/flowcms/.npmignore"))).toBe(false)
  })

  it("does not ship the publish guard, tsconfig or sources", () => {
    for (const entry of flowcms.files) {
      expect(entry).not.toMatch(/tsconfig|publish-guard|src|test/)
    }
  })
})

describe("the example theme is shaped like a real third-party package", () => {
  it("is scoped and named for discovery", () => {
    expect(aurora.name).toBe("@example/flowcms-theme-aurora")
    expect(aurora.name).toMatch(/flowcms-theme-/)
  })

  it("takes flowcms and react as PEERS, never as dependencies", () => {
    expect(aurora.peerDependencies).toEqual({
      flowcms: ">=0.1.0 <0.2.0",
      react: "^19.0.0",
    })
    expect(aurora.dependencies).toBeUndefined()
  })

  it("bounds its flowcms peer below the next minor", () => {
    // FlowCMS is 0.x, where a minor bump is a breaking change by convention.
    // An open-ended `>=0.1.0` would claim compatibility with a contract that
    // has not been written yet.
    expect(aurora.peerDependencies.flowcms).toMatch(/<0\.2\.0/)
  })

  it("ships built output and its screenshot, not TypeScript", () => {
    expect(aurora.files).toEqual(["dist", "screenshot.png", "README.md"])
    expect(aurora.exports["."].types).toBe("./dist/index.d.ts")
    expect(aurora.exports["."].default).toBe("./dist/index.js")
    expect(aurora.exports["./screenshot.png"]).toBe("./screenshot.png")
  })

  it("carries discovery metadata the RUNTIME does not read", () => {
    // `package.json#flowcms` is for build tooling and a future installer. The
    // TypeScript manifest is authoritative at runtime, and the registry never
    // parses package.json — doing so would be a filesystem scan by another
    // name.
    expect(aurora.flowcms?.type).toBe("theme")
    expect(aurora.flowcms?.slug).toBe("aurora")

    for (const file of ["src/Themes/registry.ts", "src/Themes/packages.ts"]) {
      const source = readFileSync(join(ROOT, file), "utf8")
      expect(source, file).not.toMatch(/package\.json/)
      expect(source, file).not.toMatch(/readdirSync|readFileSync|readdir\(/)
    }
  })

  it("keeps its three version numbers distinct, because they mean different things", () => {
    const manifest = readFileSync(join(ROOT, "packages/flowcms-theme-aurora/src/manifest.ts"), "utf8")
    const settings = readFileSync(join(ROOT, "packages/flowcms-theme-aurora/src/settings.ts"), "utf8")

    expect(aurora.version).toBe("1.2.0") // the package release
    expect(manifest).toMatch(/flowcmsCompat:\s*"\^0\.1\.0"/) // which FlowCMS it renders against
    expect(settings).toMatch(/version:\s*2/) // the shape of its persisted settings
  })
})

describe("nothing depends on a protocol a registry cannot serve", () => {
  it("neither published manifest uses workspace:, file: or link:", () => {
    // The classic monorepo packaging failure: `"flowcms": "workspace:*"` resolves
    // locally and is uninstallable for everyone else. The APPLICATION may use
    // `file:` — it is never published — but a package manifest may not.
    for (const [name, manifest] of [["flowcms", flowcms], ["aurora", aurora]]) {
      const ranges = [
        ...Object.values(manifest.dependencies ?? {}),
        ...Object.values(manifest.peerDependencies ?? {}),
        ...Object.values(manifest.optionalDependencies ?? {}),
      ] as string[]
      for (const range of ranges) {
        expect(range, `${name}: ${range}`).not.toMatch(/^(workspace|file|link|portal):/)
      }
    }
  })

  it("the application resolves both packages through node_modules, not an alias", () => {
    // THE PHASE 7.2 ASSERTION. `flowcms/theme` used to be a tsconfig path and a
    // vitest alias; a fixture resolving through those proved the contract
    // compiled and could not possibly prove the package was a package.
    expect(app.devDependencies["flowcms"]).toBe("file:packages/flowcms")
    expect(app.devDependencies["@example/flowcms-theme-aurora"]).toBe(
      "file:packages/flowcms-theme-aurora",
    )

    const tsconfig = readFileSync(join(ROOT, "tsconfig.json"), "utf8")
    expect(tsconfig).not.toMatch(/"flowcms\/theme"\s*:/)
    expect(tsconfig).not.toMatch(/"@example\/flowcms-theme-aurora"\s*:/)

    const vitest = readFileSync(join(ROOT, "vitest.config.ts"), "utf8")
    // Comments explain the absence; a live alias would be an assignment.
    expect(vitest).not.toMatch(/"flowcms\/theme"\s*:\s*fileURLToPath/)
    expect(vitest).not.toMatch(/"@example\/flowcms-theme-aurora"\s*:\s*fileURLToPath/)
  })

  it("keeps the example theme out of the application's runtime dependencies", () => {
    // It is a FIXTURE. Shipping an example theme in every FlowCMS install's
    // dependency list would be product clutter, and it is registered only when
    // FLOWCMS_INTEGRATION_THEMES=1.
    expect(app.dependencies["@example/flowcms-theme-aurora"]).toBeUndefined()
    expect(app.dependencies["flowcms"]).toBeUndefined()
  })
})
