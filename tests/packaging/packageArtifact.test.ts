import { describe, expect, it } from "vitest"
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { createRequire } from "node:module"
import * as internalContract from "@/Themes/contract"

/**
 * THE BUILT ARTIFACT, checked as a consumer would meet it.
 *
 * `tests/themes/publicContract.test.ts` pins what `@/Themes/contract` exports.
 * That is necessary and it is not sufficient: it reads TypeScript source
 * through the application's own alias, so it would keep passing if the package
 * emitted nothing, emitted the wrong entry, or emitted declarations full of
 * `@/…` specifiers no consumer can resolve.
 *
 * This file reads `packages/flowcms/dist`, which is what actually ships.
 *
 * IT REQUIRES THE BUILD. `npm test` runs `build:packages` first, and the guard
 * below says so plainly rather than skipping — a suite that silently skips its
 * only artifact check is a suite that reports green on a broken package.
 */

const ROOT = process.cwd()
const PACKAGE_DIR = join(ROOT, "packages", "flowcms")
const DIST = join(PACKAGE_DIR, "dist")

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

describe("the artifact exists", () => {
  it("has been built", () => {
    expect(
      existsSync(join(DIST, "index.js")),
      "packages/flowcms/dist is missing — run `npm run build:packages` (npm test does this for you)",
    ).toBe(true)
  })
})

const FILES = existsSync(DIST) ? walk(DIST) : []
const rel = (file: string) => relative(PACKAGE_DIR, file).split(sep).join("/")

/** Emitted code with comments removed, so prose cannot trip a path guard. */
function code(source: string): string {
  const BLOCK = new RegExp("/\\*[\\s\\S]*?\\*/", "g")
  const LINE = new RegExp("(^|[^:])//.*$", "gm")
  return source.replace(BLOCK, "").replace(LINE, "$1")
}

describe("no internal path survives into shipped output", () => {
  it.each([
    ["@/", "the application's alias — unresolvable outside this repository"],
    ["src/Themes", "an internal source path"],
    ["src/Framework", "an internal source path"],
    ["src/Modules", "an internal source path"],
    ["src/db", "an internal source path"],
    ["src/components", "an internal source path"],
    ["src/lib", "an internal source path"],
  ])("no emitted file contains %s (%s)", (needle) => {
    const offenders = FILES.filter((file) => code(readFileSync(file, "utf8")).includes(needle)).map(rel)
    expect(offenders).toEqual([])
  })

  it("imports only react, clsx, tailwind-merge and its own files", () => {
    // The positive form: a specifier invented after this test was written is
    // still caught. Anything else here is a dependency a theme author would
    // have to install without being told.
    const allowed = new Set(["react", "react/jsx-runtime", "react/jsx-dev-runtime", "clsx", "tailwind-merge"])
    const offenders: string[] = []
    for (const file of FILES) {
      for (const match of code(readFileSync(file, "utf8")).matchAll(/\bfrom\s*["']([^"']+)["']/g)) {
        const specifier = match[1]
        if (specifier.startsWith(".")) continue
        if (allowed.has(specifier)) continue
        offenders.push(`${rel(file)} → ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("every relative specifier carries an extension Node can resolve", () => {
    // tsc under `moduleResolution: "bundler"` emits `./views`, which works in a
    // bundler and throws ERR_MODULE_NOT_FOUND under plain Node. A package that
    // only runs inside a bundler cannot be smoke tested, and that is how a
    // broken artifact ships.
    const offenders: string[] = []
    for (const file of FILES) {
      for (const match of readFileSync(file, "utf8").matchAll(/\bfrom\s*["'](\.[^"']*)["']/g)) {
        if (!match[1].endsWith(".js")) offenders.push(`${rel(file)} → ${match[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("ships no declaration maps and no source maps", () => {
    // A declaration map points at `.ts` sources that are not in the tarball, so
    // every consumer "go to definition" would 404; shipping the sources to fix
    // that would publish the application's file layout.
    expect(FILES.filter((f) => f.endsWith(".map")).map(rel)).toEqual([])
  })

  it("keeps @types/node out of the public declarations", () => {
    // The package compiles against it so `publicImageUrl` can read
    // NEXT_PUBLIC_BASE_URL. A declaration naming a Node type would make
    // @types/node a silent requirement of writing a theme.
    const nodeTypes = new RegExp("\\b(NodeJS|Buffer|process)\\b")
    const offenders = FILES.filter(
      (f) => f.endsWith(".d.ts") && nodeTypes.test(code(readFileSync(f, "utf8"))),
    ).map(rel)
    expect(offenders).toEqual([])
  })
})

describe("core-only code is absent from the tarball, not merely unexported", () => {
  it.each([
    "validateManifest",
    "validateTheme",
    "themeManifestSchema",
    "validateSettingsDefinition",
    "isSafeColor",
    "isCompatible",
    "parseSemver",
  ])("%s is nowhere in the built package", (name) => {
    // Phase 6.7 stopped EXPORTING these to theme authors; 7.2 stopped SHIPPING
    // them. They live in src/Themes/validation now. An unexported function in
    // the tarball is still an invitation — and still weight a theme author
    // downloads for nothing.
    const offenders = FILES.filter((f) => readFileSync(f, "utf8").includes(`function ${name}`)).map(rel)
    expect(offenders).toEqual([])
  })

  it("ships no Zod, no schema and no validator module", () => {
    expect(FILES.map(rel).filter((f) => /manifest|compat|valid/i.test(f))).toEqual([])
  })

  it("does not carry AskQuestionForm", () => {
    // Audited out in Phase 7.2: a `'use client'` feature built from five shared
    // admin inputs, a Radix provider, react-hook-form, Zod and a CAPTCHA.
    // Packaging it meant shipping a copy of the admin component library.
    // Comments stripped first: the contract DOCUMENTS the removal and names
    // the component while doing so. A guard its own explanation trips is a
    // guard whoever hits it deletes the explanation to satisfy.
    const offenders = FILES.filter((f) => code(readFileSync(f, "utf8")).includes("AskQuestionForm")).map(rel)
    expect(offenders).toEqual([])
  })
})

describe("the packaged export and the in-repo contract are the same surface", () => {
  it("exports exactly what @/Themes/contract exports", async () => {
    // §42's parity check, and the reason it matters: the application keeps
    // importing `@/Themes/contract` internally, so nothing in normal
    // development would notice the two drifting apart. A theme author only ever
    // sees the packaged one.
    const packaged = await import("flowcms/theme")
    expect(Object.keys(packaged).sort()).toEqual(Object.keys(internalContract).sort())
  })

  it("resolves `flowcms/theme` out of node_modules, not through an alias", () => {
    // NODE'S OWN RESOLVER, deliberately. `import.meta.resolve` is not provided
    // in a Vite-transformed module, and asking Vite would only report what Vite
    // thinks — which is exactly what an alias used to fake. `createRequire`
    // walks node_modules the way a consumer's runtime does.
    const resolved = createRequire(import.meta.url).resolve("flowcms/theme")
    const normalized = resolved.split(sep).join("/")

    // It lands on the package's BUILT entry, through its `exports` map.
    expect(normalized).toMatch(/flowcms\/dist\/index\.js$/)
    // And never on the TypeScript source, which is what the deleted alias did.
    expect(normalized).not.toMatch(/src\/Themes\/contract/)

    // The path is the repository's own `packages/flowcms` because npm links a
    // `file:` dependency and Node reports the real path. That is the right
    // setup for developing the package and it is NOT the distribution proof —
    // a link exposes the whole directory, so every `files` mistake works
    // anyway. `scripts/verify-package-consumer.mjs` installs the tarball into a
    // temp directory outside this repository and asserts the resolved path is
    // under the consumer's node_modules with no symlink back.
  })

  it("the packaged runtime helpers actually run", async () => {
    // Types resolving does not mean a re-export compiled. Each of these reaches
    // a different emitted file.
    const packaged = await import("flowcms/theme")
    expect(packaged.cn("p-2", "p-4")).toBe("p-4")
    expect(packaged.readingTimeMinutes(1000)).toBe(5)
    expect(packaged.howToStepAnchor(0)).toBe("howto-step-1")
    expect(packaged.publicImagePath("dir/a b.png")).toBe("/api/public/images/dir/a%20b.png")
    expect([...packaged.THEME_SURFACES]).toHaveLength(8)
    expect(packaged.FLOWCMS_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(typeof packaged.JsonLd).toBe("function")
    const definition = { version: 1, fields: [] as never[] }
    expect(packaged.defineThemeSettings(definition)).toBe(definition)
  })

  it("reports the same version as the package it ships in", async () => {
    const packaged = await import("flowcms/theme")
    const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8"))
    expect(packaged.FLOWCMS_VERSION).toBe(manifest.version)
  })
})

describe("the example theme's artifact", () => {
  const AURORA = join(ROOT, "packages", "flowcms-theme-aurora")
  const AURORA_DIST = join(AURORA, "dist")

  it("has been built", () => {
    expect(
      existsSync(join(AURORA_DIST, "index.js")),
      "run `npm run build:packages`",
    ).toBe(true)
  })

  it("imports FlowCMS only as `flowcms/theme`", () => {
    const allowed = new Set(["flowcms/theme", "react", "react/jsx-runtime", "react/jsx-dev-runtime"])
    const offenders: string[] = []
    for (const file of walk(AURORA_DIST)) {
      for (const match of code(readFileSync(file, "utf8")).matchAll(/\bfrom\s*["']([^"']+)["']/g)) {
        if (match[1].startsWith(".")) continue
        if (allowed.has(match[1])) continue
        offenders.push(`${relative(AURORA, file)} → ${match[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("carries the Tailwind utilities its markup uses", () => {
    // The class strings have to survive compilation as literals, or the
    // `@source` registration in globals.css has nothing to find.
    const layout = readFileSync(join(AURORA_DIST, "Layout.js"), "utf8")
    expect(layout).toContain("tracking-[0.4375em]")
    expect(layout).toMatch(/className:/)
  })

  it("ships its screenshot beside the code", () => {
    expect(existsSync(join(AURORA, "screenshot.png"))).toBe(true)
    // A real image, not a placeholder byte: the PNG signature.
    const header = readFileSync(join(AURORA, "screenshot.png")).subarray(0, 8)
    expect([...header]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })
})
