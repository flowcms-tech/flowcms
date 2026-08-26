import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * Layering rules, enforced rather than documented.
 *
 * `src/Framework` is the cross-cutting service layer: auth, storage, settings,
 * cache, integrations. `src/Modules` is feature and presentation code. The
 * dependency runs one way — Modules may import Framework, never the reverse.
 *
 * This existed as a convention and was violated in the one place it mattered
 * most: `SettingsService`, the app's central config resolver — imported by the
 * root layout, `robots.ts`, the sitemap, and every public page — imported a
 * *customer's* content config to use as its fallback layer. The effect was that
 * one business's street address and two real phone numbers were compiled into
 * the framework of software intended for general distribution.
 *
 * A convention that is only written down gets violated again by whoever needs a
 * value that happens to live on the wrong side of the line. A test does not.
 */

const SRC = fileURLToPath(new URL("../../src", import.meta.url))

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

/** Every module specifier in a file, from static imports, type imports, and
 *  dynamic `import()`. */
function importsOf(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /^\s*import\s[^'"]*from\s+['"]([^'"]+)['"]/gm, // import x from "y"
    /^\s*import\s+['"]([^'"]+)['"]/gm, //             import "y"
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, //      import("y")
    /^\s*export\s[^'"]*from\s+['"]([^'"]+)['"]/gm, // export … from "y"
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1])
  }
  return specifiers
}

function rel(file: string): string {
  return relative(SRC, file).split(sep).join("/")
}

const frameworkFiles = walk(join(SRC, "Framework"))

describe("src/Framework must not depend on src/Modules", () => {
  it("finds the Framework tree (guards against the walker matching nothing)", () => {
    expect(frameworkFiles.length).toBeGreaterThan(20)
  })

  it("never imports customer or presentation code — no @/Modules/Public", () => {
    // The hard rule. This is the violation that put one business's street
    // address and phone numbers inside the framework, and it has no exemptions.
    const offenders: string[] = []
    for (const file of frameworkFiles) {
      for (const specifier of importsOf(readFileSync(file, "utf8"))) {
        if (specifier.includes("Modules/Public")) {
          offenders.push(`${rel(file)} -> ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  /**
   * Pre-existing imports of pure Blog helpers, pinned rather than fixed.
   *
   * `extractLinks` and `toInternalPath` are content and URL utilities — not
   * customer data and not presentation — so they do not carry the risk the rule
   * above exists to prevent. But they do sit on the wrong side of the layering
   * line, and `contentStats` has thirteen importers, so relocating it is a
   * refactor of its own and does not belong in a phase about deleting a
   * customer site.
   *
   * Listed exactly, so the debt is visible, cannot quietly grow, and has a
   * written home in the next phase's scope.
   */
  const KNOWN_FRAMEWORK_TO_MODULES = [
    "Framework/Integrations/LinkChecker.ts -> @/Modules/Blog/Posts/Values/contentStats",
    "Framework/Integrations/LinkChecker.ts -> @/Modules/Blog/Posts/Values/internalUrls",
  ]

  it("has no import of @/Modules beyond the pinned, known exceptions", () => {
    const found: string[] = []
    for (const file of frameworkFiles) {
      for (const specifier of importsOf(readFileSync(file, "utf8"))) {
        if (specifier.startsWith("@/Modules")) {
          found.push(`${rel(file)} -> ${specifier}`)
        }
      }
    }

    const unexpected = found.filter((entry) => !KNOWN_FRAMEWORK_TO_MODULES.includes(entry))
    expect(
      unexpected,
      `New src/Framework -> src/Modules dependency. Move the shared value into ` +
        `Framework, or invert the call so the Module passes it in:\n  ` +
        unexpected.join("\n  ")
    ).toEqual([])

    // And the exceptions must still be real: a stale entry would let a genuine
    // new violation hide behind a name nobody checks.
    const stale = KNOWN_FRAMEWORK_TO_MODULES.filter((entry) => !found.includes(entry))
    expect(stale, `These pinned exceptions no longer exist — delete them`).toEqual([])
  })

  it("has no relative import that escapes into src/Modules", () => {
    // `@/Modules/...` is the obvious spelling; `../../Modules/...` is the one
    // that slips through a grep for the obvious spelling.
    const offenders: string[] = []
    for (const file of frameworkFiles) {
      for (const specifier of importsOf(readFileSync(file, "utf8"))) {
        if (!specifier.startsWith(".")) continue
        const resolved = join(file, "..", specifier)
        const relativeToSrc = relative(SRC, resolved).split(sep).join("/")
        if (relativeToSrc.startsWith("Modules/")) {
          offenders.push(`${rel(file)} -> ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("does not import route handlers or pages either", () => {
    // Framework depending on src/app would be the same inversion wearing a
    // different directory name.
    const offenders: string[] = []
    for (const file of frameworkFiles) {
      for (const specifier of importsOf(readFileSync(file, "utf8"))) {
        if (specifier.startsWith("@/app/")) offenders.push(`${rel(file)} -> ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe("no source file imports a removed customer module", () => {
  const allFiles = walk(SRC)

  it("finds the src tree", () => {
    expect(allFiles.length).toBeGreaterThan(200)
  })

  it("has no import of the deleted customer config or homepage directions", () => {
    const forbidden = [
      "Modules/Public/config",
      "Modules/Public/Home",
      "Modules/Public/Services",
      "Modules/Public/Values",
      "Modules/Customers",
    ]
    const offenders: string[] = []
    for (const file of allFiles) {
      for (const specifier of importsOf(readFileSync(file, "utf8"))) {
        for (const banned of forbidden) {
          if (specifier.includes(banned)) offenders.push(`${rel(file)} -> ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
