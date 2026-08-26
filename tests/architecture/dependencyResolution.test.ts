import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"

/**
 * DEPENDENCIES THAT RESOLVE ONLY BECAUSE npm HOISTS.
 *
 * Phase 8.6 found that three of the four supported package managers could not
 * complete `next build` on a generated project, for two causes that are the
 * same mistake wearing different clothes: SOURCE NAMED A PACKAGE THE MANIFEST
 * DID NOT DECLARE, and npm's flat `node_modules` made that invisible.
 *
 *   1. `@types/minimatch` — a DefinitelyTyped stub with no types of its own,
 *      declared in devDependencies while nothing in the repository references
 *      minimatch. TypeScript auto-loads every `@types/*` package as an implicit
 *      type library, so the stub had to resolve `minimatch`, which only worked
 *      where the manager hoisted it. pnpm, yarn Classic and bun do not:
 *      `Cannot find type definition file for 'minimatch'`.
 *
 *   2. `src/Framework/Auth/next-auth.d.ts` augmenting `"@auth/core/jwt"` while
 *      `@auth/core` was a transitive package only. Under pnpm the augmentation
 *      silently did nothing and `token.id` degraded to `{}`.
 *
 * The second is the more dangerous shape, because a module augmentation that
 * cannot resolve its target is not always an error — it can just be a no-op, so
 * the type you believed you had quietly becomes `{}`.
 *
 * These assertions read MANIFESTS ONLY. No install, no network, no build.
 */

const ROOT = process.cwd()
const readJson = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8"))

const manifest = readJson("package.json") as {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}
const lock = readJson("package-lock.json") as {
  packages: Record<string, { version?: string; dependencies?: Record<string, string> }>
}

const declared = { ...manifest.dependencies, ...manifest.devDependencies }

/** `@types/foo` → `foo`; `@types/foo__bar` → `@foo/bar`, DefinitelyTyped's scoped encoding. */
function realPackageFor(typesPackage: string): string {
  const stem = typesPackage.slice("@types/".length)
  return stem.includes("__") ? `@${stem.replace("__", "/")}` : stem
}

describe("no declared @types package is a deprecated stub", () => {
  // A DefinitelyTyped stub has a recognisable shape in the lockfile: its single
  // dependency is the real package, at `*`. That is the whole package — it
  // ships no `.d.ts`, exists only to redirect, and is published purely so an
  // old `@types/x` install keeps resolving. Declaring one buys nothing and
  // costs a hoisting assumption, because TypeScript loads it regardless of
  // whether anything imports the package it points at.
  const typePackages = Object.keys(declared).filter((name) => name.startsWith("@types/"))

  it("declares at least one @types package, so this suite is not vacuous", () => {
    expect(typePackages.length).toBeGreaterThan(0)
  })

  it.each(typePackages)("%s ships real types", (name) => {
    const entry = lock.packages[`node_modules/${name}`]
    // Absent from the lockfile is a different failure (a stale lock), and
    // `npm ci` reports it far more clearly than this assertion could.
    if (!entry) return

    const deps = Object.entries(entry.dependencies ?? {})
    const isStub =
      deps.length === 1 && deps[0][0] === realPackageFor(name) && deps[0][1] === "*"

    expect(
      isStub,
      `${name} is a stub types definition — ${realPackageFor(name)} ships its own types. ` +
        "Remove it: TypeScript auto-loads it as an implicit type library and it then " +
        "has to resolve a package this repository may not even use.",
    ).toBe(false)
  })

  it("the two stubs removed in Phase 8.7 have not come back", () => {
    // Named explicitly as well as caught by the rule above, because these two
    // are the ones an editor's "add missing types" quick-fix reinstates.
    expect(declared["@types/minimatch"]).toBeUndefined()
    expect(declared["@types/bcryptjs"]).toBeUndefined()
  })
})

describe("every module augmented in src/ belongs to a declared dependency", () => {
  // `declare module "x"` against a package you do not depend on is fragile by
  // construction: it works wherever the manager happens to hoist `x` and stops
  // working — usually silently — where it does not.
  //
  // Anchored at the start of a line so prose in a doc comment explaining why a
  // particular augmentation is WRONG does not register as one.
  const AUGMENTED = /^declare\s+module\s+["']([^"']+)["']/gm

  /** `@auth/core/jwt` → `@auth/core`; `next-auth/jwt` → `next-auth`. */
  function packageOf(specifier: string): string {
    const parts = specifier.split("/")
    return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
  }

  function sourceFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...sourceFiles(path))
      else if (/\.(ts|tsx|mts)$/.test(entry.name)) out.push(path)
    }
    return out
  }

  const augmentations = sourceFiles(join(ROOT, "src")).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(AUGMENTED)].map((m) => ({
      file: relative(ROOT, file).replace(/\\/g, "/"),
      specifier: m[1],
    })),
  )

  it("finds the augmentations it is meant to police", () => {
    const specifiers = augmentations.map((a) => a.specifier)
    expect(specifiers).toContain("@auth/core/jwt")
    expect(specifiers).toContain("next-auth")
  })

  it("augments no package that is only transitively present", () => {
    const undeclared = augmentations
      .filter((a) => !a.specifier.startsWith(".") && !a.specifier.startsWith("*"))
      .filter((a) => !(packageOf(a.specifier) in declared))
      .map((a) => `${a.file} augments "${a.specifier}"`)

    expect(
      undeclared,
      "these augmentations resolve under npm only because npm hoists the package",
    ).toEqual([])
  })
})

describe("@auth/core is pinned to exactly one copy", () => {
  // The augmentation targets an INTERFACE IDENTITY. Two copies of @auth/core in
  // the tree means two unrelated `JWT` interfaces, and the augmentation lands on
  // whichever one the root resolves — not necessarily the one next-auth's
  // callbacks are typed against. That failure has no error message at all.
  //
  // A caret range makes that outcome a matter of npm's mood on the day a patch
  // release lands. An exact pin equal to what next-auth pins does not.
  const pinnedBy = (pkg: string) =>
    lock.packages[`node_modules/${pkg}`]?.dependencies?.["@auth/core"]

  it("is a direct dependency, not merely hoisted", () => {
    expect(manifest.dependencies["@auth/core"]).toBeDefined()
  })

  it("is an exact version, not a range", () => {
    expect(manifest.dependencies["@auth/core"]).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it("matches the version next-auth and @auth/drizzle-adapter pin", () => {
    const ours = manifest.dependencies["@auth/core"]
    expect(pinnedBy("next-auth"), "next-auth no longer pins @auth/core exactly").toBe(ours)
    expect(pinnedBy("@auth/drizzle-adapter")).toBe(ours)
  })

  it("resolves to a single copy in the lockfile", () => {
    const copies = Object.keys(lock.packages).filter((p) => p.endsWith("node_modules/@auth/core"))
    expect(copies).toEqual(["node_modules/@auth/core"])
  })
})

describe("next is at or above the advisory floor", () => {
  // GHSA: proxy/middleware bypass in App Router applications built with
  // Turbopack, affecting 9.3.4-canary.0 through 16.3.0-preview.10, fixed in
  // 16.3.2. FlowCMS routes EVERY admin request through `src/proxy.ts`, so in
  // this application a proxy bypass is an authorization bypass. Downgrading
  // back under the floor has to fail here rather than in an audit nobody runs.
  const FLOOR = [16, 3, 2] as const

  it("is pinned exactly, like react and drizzle-orm", () => {
    expect(manifest.dependencies.next).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it("is >= 16.3.2", () => {
    const parts = manifest.dependencies.next.split(".").map(Number)
    const atLeast =
      parts[0] > FLOOR[0] ||
      (parts[0] === FLOOR[0] &&
        (parts[1] > FLOOR[1] || (parts[1] === FLOOR[1] && parts[2] >= FLOOR[2])))
    expect(atLeast, `next ${manifest.dependencies.next} is inside the proxy-bypass advisory`).toBe(
      true,
    )
  })
})
