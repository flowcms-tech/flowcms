import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

/**
 * THE PACKAGE BOUNDARY.
 *
 * The default theme lives in this repository, so it proves nothing about
 * whether the contract is sufficient — it could reach past `flowcms/theme` at
 * any point and nobody would notice until somebody outside this repo tried to
 * write a theme, by which point the missing export is a breaking change to add.
 *
 * `packages/flowcms-theme-aurora/` is that outside party. It sits outside
 * `src/`, has its own `package.json` and its own tsconfig, and imports FlowCMS
 * only through the specifier a published theme uses.
 *
 * WHAT PHASE 7.2 CHANGED: `flowcms/theme` used to be a tsconfig path and a
 * vitest alias, so this fixture proved the contract COMPILED and could prove
 * nothing about whether it could be installed. Both aliases are gone and both
 * packages resolve through node_modules.
 *
 * THIS FILE READS SOURCE. The BUILT artifacts are checked in
 * `tests/packaging/packageArtifact.test.ts`, the manifests in
 * `tests/packaging/packageMetadata.test.ts`, and the whole thing end to end by
 * `scripts/verify-package-consumer.mjs`. Source rules and artifact rules are
 * kept apart on purpose: a theme author writes source, and a consumer installs
 * an artifact, and only one of the two can be fixed by editing this repository.
 *
 * WHY IT MOVED OUT OF `tests/` IN PHASE 6.7: `.dockerignore` excludes `tests`,
 * so a theme living there can never reach the production image. A fixture that
 * cannot be installed is not proving that themes can be installed.
 */

const PACKAGE_ROOT = join(process.cwd(), "packages", "flowcms-theme-aurora")

/** The complete set of non-relative imports a package theme may make. */
const ALLOWED_SPECIFIERS = new Set(["flowcms/theme", "react", "react/jsx-runtime"])

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(full) ? [full] : []
  })
}

const SOURCE_FILES = walk(join(PACKAGE_ROOT, "src"))
const rel = (file: string) => relative(PACKAGE_ROOT, file).split(sep).join("/")

const IMPORT = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g

/**
 * Source with comments removed.
 *
 * The registration modules DOCUMENT the rules they follow and name
 * `import(variable)` while doing so. A guard that a comment can trip is a guard
 * people learn to work around, so the discovery check reads code only.
 */
function stripComments(source: string): string {
  const BLOCK = new RegExp("/\\*[\\s\\S]*?\\*/", "g")
  const LINE = new RegExp("(^|[^:])//.*$", "gm")
  return source.replace(BLOCK, "").replace(LINE, "$1")
}

describe("the guard is wired up", () => {
  it("found the package's source files", () => {
    // A walk that silently matched nothing would let every assertion below pass
    // against an empty set.
    expect(SOURCE_FILES.length).toBeGreaterThanOrEqual(5)
  })
})

describe("a package theme imports only the public contract", () => {
  it("makes no non-relative import outside the allowed set", () => {
    // THE ASSERTION THE PACKAGE EXISTS FOR. If it fails, the contract is
    // missing something and a real theme author would hit the same wall.
    const offenders: string[] = []
    for (const file of SOURCE_FILES) {
      for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
        const specifier = match[1]
        if (specifier.startsWith(".")) continue
        if (ALLOWED_SPECIFIERS.has(specifier)) continue
        offenders.push(`${rel(file)} → ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it.each([
    ["@/", "the application's own alias — a published package cannot resolve it"],
    ["@/db", "database access"],
    ["@/Framework", "framework internals"],
    ["@/Modules", "application modules"],
    ["@/app", "route files"],
    ["@/components", "the admin component library"],
    ["@/lib", "app utilities — `cn` comes from the contract"],
  ])("never reaches for %s (%s)", (prefix) => {
    const offenders: string[] = []
    for (const file of SOURCE_FILES) {
      for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
        if (match[1].startsWith(prefix)) offenders.push(`${rel(file)} → ${match[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("does not escape its own directory with a relative path", () => {
    const offenders: string[] = []
    for (const file of SOURCE_FILES) {
      for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
        if (match[1].startsWith("../")) offenders.push(`${rel(file)} → ${match[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("names no SEO builder", () => {
    // The hardest rule to keep and the most important: a theme that can build
    // structured data can publish claims about the operator's business.
    const offenders: string[] = []
    for (const file of SOURCE_FILES) {
      const source = readFileSync(file, "utf8")
      if (/buildJsonLd|buildPostMetadata|buildLocalBusinessJsonLd|buildPageJsonLd/.test(source)) {
        offenders.push(rel(file))
      }
    }
    expect(offenders).toEqual([])
  })

  it("does not declare the public colour boundary", () => {
    // `.public-surface` is core's, applied once in ThemeShell. A theme that
    // declared it would nest two token scopes and the inner one would win for
    // reasons invisible in the markup.
    for (const file of SOURCE_FILES) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toContain("public-surface")
    }
  })
})

/*
 * The package MANIFEST assertions that used to live here — name, peers,
 * discovery metadata, the three version numbers — moved to
 * `tests/packaging/packageMetadata.test.ts` in Phase 7.2, alongside the
 * `flowcms` manifest they now have to agree with. Splitting them would have
 * meant two files disagreeing about what a package is.
 */

describe("the registry is the source of truth for what is installed", () => {
  it("has no installed-themes table in the schema", () => {
    // Two sources of truth for "what is installed" would disagree on the first
    // deploy: the build decides, and a database row cannot make code exist.
    const schema = readFileSync(join(process.cwd(), "src/db/schema/index.ts"), "utf8")
    expect(schema).not.toMatch(/installedTheme/i)

    const walkSchema = walk(join(process.cwd(), "src/db/schema"))
    for (const file of walkSchema) {
      const source = readFileSync(file, "utf8")
      // A comment may explain why the table does not exist; a table definition
      // may not.
      expect(source, file).not.toMatch(/sqliteTable\(\s*"installed_themes"/)
    }
  })

  it("builds the installed list from static entries, not from a query", () => {
    const registry = stripComments(
      readFileSync(join(process.cwd(), "src/Themes/registry.ts"), "utf8"),
    )
    // No database client, no await, no query anywhere in registry construction.
    expect(registry).not.toMatch(/@\/db|drizzle-orm/)
    expect(registry).not.toMatch(/\bawait\b/)
  })
})

describe("no runtime discovery exists anywhere in theme registration", () => {
  it("uses static imports only — no import(variable), no directory scan", () => {
    for (const file of ["src/Themes/registry.ts", "src/Themes/packages.ts", "src/Themes/integration/index.ts"]) {
      // Comments stripped first: these files DOCUMENT the rule they follow and
      // name `import(variable)` while doing so. A guard a comment can trip is a
      // guard people learn to work around.
      const source = stripComments(readFileSync(join(process.cwd(), file), "utf8"))
      // A dynamic import of a computed specifier is what Next's tracer cannot
      // follow, and what would let code outside review execute on the server.
      expect(source, file).not.toMatch(/import\(\s*[a-zA-Z_$]/)
      expect(source, file).not.toMatch(/require\(\s*[a-zA-Z_$]/)
      expect(source, file).not.toMatch(/node:fs|from "fs"/)
    }
  })
})
