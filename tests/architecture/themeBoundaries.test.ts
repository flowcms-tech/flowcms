import { describe, expect, it } from "vitest"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

/**
 * The theme boundary, enforced on disk.
 *
 * The contract says a theme imports from `@/Themes/contract` and nothing else.
 * Today every theme lives in this repository and could import anything it
 * likes, so that rule holds only as long as nobody takes a shortcut — and the
 * day the first npm-distributed theme ships, every shortcut taken since becomes
 * a breaking change for theme authors.
 *
 * A comment cannot enforce this. This walks the directory, which cannot rot,
 * and is the same technique `tests/auth/routeCoverage.test.ts` uses to keep
 * route policies honest.
 */

const THEMES_ROOT = join(process.cwd(), "src", "Themes")
const CONTRACT_ROOT = join(THEMES_ROOT, "contract")

/**
 * Core's validators for theme-supplied data, moved out of the contract in
 * Phase 7.2 so they are absent from the published package rather than merely
 * unexported.
 *
 * Excluded here for the same reason `registry.ts` and `resolver.ts` are: they
 * sit under `src/Themes` because that is what they are about, not because they
 * are themes. Holding them to the theme rules would be nonsense — they exist to
 * hold an opinion about a theme, which requires knowing FLOWCMS_VERSION and the
 * contract's own shapes.
 */
const VALIDATION_ROOT = join(THEMES_ROOT, "validation")

function walk(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...walk(full))
    else if (/\.tsx?$/.test(full)) found.push(full)
  }
  return found
}

/**
 * Theme source: everything under `src/Themes` that is actually a theme.
 *
 * Four files live there and are NOT themes — they are core infrastructure that
 * happens to sit next to what it serves, and holding them to the theme rules
 * would be nonsense: the resolver has to read Settings, and the registry has to
 * know what is installed.
 */
const CORE_IN_THEMES = [
  join(THEMES_ROOT, "registry.ts"),
  join(THEMES_ROOT, "resolver.ts"),
  // Registration glue for the integration theme. The theme itself
  // (integration/theme.tsx) is theme code and IS checked below.
  join(THEMES_ROOT, "integration", "index.ts"),
  // Registration glue for package themes: the import an operator writes, plus
  // the static asset import that puts a package's screenshot through Next's
  // pipeline. Both are the APPLICATION installing a theme, not a theme.
  join(THEMES_ROOT, "packages.ts"),
]

const THEME_FILES = walk(THEMES_ROOT).filter(
  (file) =>
    !file.startsWith(CONTRACT_ROOT) &&
    !file.startsWith(VALIDATION_ROOT) &&
    !CORE_IN_THEMES.includes(file),
)

const IMPORT = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8")
  return [...source.matchAll(IMPORT)].map((match) => match[1])
}

/** `import type { … } from "…"`, including the multi-line form. */
const TYPE_IMPORT = /import\s+type\s+[\s\S]*?from\s+["'][^"']+["']/g

/**
 * Imports that survive to runtime.
 *
 * A type-only import is erased by the compiler: it creates no module edge,
 * ships no code, and cannot drag a theme's components into a bundle. Treating
 * it as a dependency would either fail honest code or push someone toward a
 * blanket exemption — and a blanket exemption is how a real value import sneaks
 * in later. So the distinction is encoded rather than waived.
 */
function valueImportsOf(file: string): string[] {
  const source = readFileSync(file, "utf8").replace(TYPE_IMPORT, "")
  return [...source.matchAll(IMPORT)].map((match) => match[1])
}

describe("theme source layout", () => {
  it("finds theme files to check", () => {
    // Guards the guard: a walk that silently matches nothing would let every
    // assertion below pass on an empty set.
    expect(THEME_FILES.length).toBeGreaterThan(10)
  })
})

describe("themes may not reach into core internals", () => {
  const forbidden = [
    ["@/db", "database access — themes render view models, they never query"],
    ["@/Modules", "application modules — go through @/Themes/contract"],
    ["@/Framework", "framework internals — go through @/Themes/contract"],
    ["@/lib", "app utilities — `cn` is re-exported from @/Themes/contract"],
    ["@/components", "the admin component library"],
    ["@/app", "route files"],
  ]

  it.each(forbidden)("no theme imports %s (%s)", (prefix) => {
    const offenders: string[] = []
    for (const file of THEME_FILES) {
      for (const specifier of importsOf(file)) {
        if (specifier === prefix || specifier.startsWith(`${prefix}/`)) {
          offenders.push(`${relative(process.cwd(), file)} → ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("no theme imports the SEO builders", () => {
    // The hardest rule to keep and the most important. A theme that can build
    // structured data can publish claims about the operator's business that
    // the operator never made, and nobody reviews a theme's JSON-LD.
    const offenders: string[] = []
    for (const file of THEME_FILES) {
      for (const specifier of importsOf(file)) {
        if (/buildJsonLd|buildPostMetadata|buildAuthorJsonLd|buildLocalBusinessJsonLd|buildPageJsonLd/.test(specifier)) {
          offenders.push(`${relative(process.cwd(), file)} → ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("no theme escapes its directory with a relative path", () => {
    // `../../Modules/...` evades every prefix check above.
    const offenders: string[] = []
    for (const file of THEME_FILES) {
      for (const specifier of importsOf(file)) {
        if (specifier.startsWith("../..")) {
          offenders.push(`${relative(process.cwd(), file)} → ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("every non-relative FlowCMS import a theme makes is the contract", () => {
    // The positive form of the rules above, so a core path invented after this
    // test was written is still caught.
    const offenders: string[] = []
    for (const file of THEME_FILES) {
      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith("@/")) continue
        if (specifier === "@/Themes/contract") continue
        offenders.push(`${relative(process.cwd(), file)} → ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe("the contract does not leak internal paths", () => {
  it("names no internal path in the barrel a theme author reads", () => {
    // The facade is the product surface. Every internal path is resolved one
    // level down, in ./views and ./runtime, so a theme author reading the
    // barrel cannot learn — or be tempted to type — an application path.
    const external = importsOf(join(CONTRACT_ROOT, "index.ts")).filter((s) => !s.startsWith("./"))
    expect(external).toEqual([])
  })
})

describe("core does not depend on themes", () => {
  it("reaches themes only through the contract and the resolver", () => {
    // The dependency runs one way, and after Phase 6.2 it runs through exactly
    // two doors: `@/Themes/contract` for the shared type vocabulary, and
    // `@/Themes/resolver` for dispatch. Anything else — importing
    // `@/Themes/default` in particular — is core deciding which theme renders,
    // which is the decision the resolver exists to own.
    //
    // In 6.1 this test carried an allow-list of five temporary bridge modules
    // that re-exported the default theme. They are gone; so is the list.
    const coreFiles = [
      ...walk(join(process.cwd(), "src", "Modules")),
      ...walk(join(process.cwd(), "src", "Framework")),
      ...walk(join(process.cwd(), "src", "db")),
    ]

    const offenders: string[] = []
    for (const file of coreFiles) {
      // Value imports only — a type import is erased and couples nothing.
      for (const specifier of valueImportsOf(file)) {
        if (!specifier.startsWith("@/Themes")) continue
        if (specifier.startsWith("@/Themes/contract")) continue
        if (specifier === "@/Themes/resolver") continue
        // Dependency-free shared constants: the default slug and the
        // activation/no-op rules the admin screen and the API must agree on.
        // Safe from anywhere, including client bundles, by construction.
        if (specifier === "@/Themes/constants") continue
        // Core's own validators for theme-supplied data — `validateManifest`,
        // `isCompatible`, `validateSettingsDefinition`, `isSafeColor`.
        //
        // A third door, and it is the SAME coupling core already had: these
        // lived in `@/Themes/contract` until Phase 7.2 and were reached through
        // door one. They moved because the contract directory became the source
        // of the published `flowcms` package, and shipping core's opinion of a
        // theme to theme authors is the thing Phase 6.7 decided against. The
        // modules are dependency-free and contain no theme code — they are
        // rules ABOUT themes, which is why core may read them and a theme may
        // not.
        if (specifier.startsWith("@/Themes/validation")) continue
        // The one core module allowed to see the registry: the strict write
        // path has to refuse activating a theme this build does not contain,
        // and only the registry knows what that is. Named explicitly so the
        // exemption cannot spread by accident.
        const rel = relative(process.cwd(), file).split("\\").join("/")
        // The core modules allowed to read the registry, named individually so
        // the exemption cannot spread by accident:
        //   themeSelection  — the strict write path must refuse activating a
        //                     theme this build does not contain.
        //   themeAdminQueries — the Appearance screen lists what is installed.
        //   menuAdminQueries  — a menu location must name a slot some installed
        //                     theme declares, and only the registry knows which
        //                     slots exist. Reading the ACTIVE theme's slots
        //                     would be wrong here: an operator may configure a
        //                     menu for a theme they have not switched to yet.
        // All are server-only; none renders anything.
        //   themeSettings   — resolving a theme's settings needs that theme's
        //                     declared definition, and only the registry has
        //                     it. The definition is code; the values are data.
        //   themeSettingsAdminQueries — the Theme Settings screen renders a
        //                     form from each theme's declared definition, and
        //                     the definition lives in the registry. Only the
        //                     metadata crosses to the browser.
        const REGISTRY_READERS = [
          "src/Framework/Settings/themeSelection.ts",
          "src/Framework/Settings/themeSettings.ts",
          "src/Modules/Appearance/Queries/themeAdminQueries.ts",
          "src/Modules/Appearance/Queries/menuAdminQueries.ts",
          "src/Modules/Appearance/Queries/themeSettingsAdminQueries.ts",
        ]
        if (REGISTRY_READERS.includes(rel) && specifier === "@/Themes/registry") continue
        offenders.push(`${relative(process.cwd(), file).split("\\").join("/")} → ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("has no temporary presentation bridges left", () => {
    // Phase 6.1 shipped five one-line modules re-exporting the default theme so
    // routes could keep their imports while dispatch was still unbuilt. Dead
    // compatibility layers are worse than none: the next person cannot tell a
    // deliberate seam from an abandoned one.
    const bridges = [
      "src/Modules/Blog/Public/BlogIndexModule.tsx",
      "src/Modules/Blog/Public/BlogArchiveModule.tsx",
      "src/Modules/Blog/Public/AuthorArchiveModule.tsx",
      "src/Modules/Blog/Public/BlogPostModule.tsx",
      "src/Modules/Pages/Public/CustomPageModule.tsx",
    ]
    const surviving = bridges.filter((bridge) => existsSync(join(process.cwd(), bridge)))
    expect(surviving).toEqual([])
  })
})

describe("core keeps the public colour tokens", () => {
  it("declares public-surface in exactly one place, and that place is core", () => {
    // This regressed once during Phase 6.1 and nothing caught it: the class
    // moved into the theme's Layout, which was not wired yet, so "/" silently
    // began inheriting whatever palette the admin's theme cookie last set. The
    // page still rendered, which is exactly why review missed it.
    //
    // One owner: ThemeShell. Not the routes (eight places to forget it), not a
    // theme (a theme can be replaced by one that omits it), and never two —
    // nested boundaries redefine the same tokens twice and the inner one wins
    // for reasons nobody can see from the markup.
    const sources = [
      ...walk(join(process.cwd(), "src", "app")),
      ...walk(join(process.cwd(), "src", "Modules")),
      ...walk(join(process.cwd(), "src", "Framework")),
      ...walk(THEMES_ROOT),
    ]

    const declaring = sources
      .filter((file) => /className[^\n]*public-surface/.test(readFileSync(file, "utf8")))
      .map((file) => relative(process.cwd(), file).split("\\").join("/"))

    expect(declaring).toEqual(["src/Modules/Public/Components/ThemeShell.tsx"])
  })

  it("keeps the boundary outside every theme", () => {
    const inThemes = walk(THEMES_ROOT).filter((file) =>
      readFileSync(file, "utf8").includes("public-surface"),
    )
    expect(inThemes).toEqual([])
  })
})
