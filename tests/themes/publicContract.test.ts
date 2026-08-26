import { describe, expect, it } from "vitest"
import * as contract from "@/Themes/contract"

/**
 * THE PUBLIC THEME API, pinned.
 *
 * `@/Themes/contract` — reachable by a package as `flowcms/theme` — is the
 * surface a third-party theme is written against. Once themes exist outside
 * this repository, removing or renaming anything here breaks them, and the
 * break is invisible at build time because the theme is not in this build.
 *
 * So the export NAMES are asserted. Not their shapes, not their implementations
 * — a snapshot of internals would fail on every refactor and get regenerated
 * without being read, which is worse than no test. A sorted name list fails
 * only when the SURFACE changes, which is exactly when a human should look.
 *
 * Adding an export is additive and safe: add it here in the same commit.
 * Removing one is a breaking change to every theme and needs a FlowCMS version
 * bump and a note in `docs/themes/authoring.md`.
 *
 * Types are not visible at runtime, so this pins the VALUE exports; the type
 * surface is pinned by the package fixture compiling against it.
 */

/** Every value the contract exports. Sorted, so ordering never matters. */
const PUBLIC_VALUE_EXPORTS = [
  "FLOWCMS_VERSION",
  "JsonLd",
  "THEME_SURFACES",
  "cn",
  "defineThemeSettings",
  "howToStepAnchor",
  "publicImagePath",
  "publicImageUrl",
  "readingTimeMinutes",
  "themeSettingsOf",
]

describe("the public theme contract", () => {
  it("exports exactly the approved values", () => {
    expect(Object.keys(contract).sort()).toEqual(PUBLIC_VALUE_EXPORTS)
  })

  it("does not re-export core's registry-time validators", () => {
    // Audited out in Phase 6.7. Core runs these ON a theme; a theme running
    // them on itself would be a second opinion about its own validity, and the
    // registry's opinion is the only one that decides anything. They still
    // exist on `./manifest`, `./compat` and `./settings` for core and tests.
    for (const name of [
      "validateManifest",
      "validateTheme",
      "themeManifestSchema",
      "validateSettingsDefinition",
      "isCompatible",
      "parseSemver",
      "isSafeColor",
    ]) {
      expect(contract, name).not.toHaveProperty(name)
    }
  })

  it("keeps the security-critical helper reachable", () => {
    // A theme MUST be able to render core-built JSON-LD. If it became
    // unreachable, theme authors would hand-roll it and inherit an escaping bug.
    expect(typeof contract.JsonLd).toBe("function")
  })

  it("does NOT export AskQuestionForm, which was audited out in Phase 7.2", () => {
    // It is a `'use client'` feature, not a helper: five shared admin inputs, a
    // Radix provider, react-hook-form, Zod, a CAPTCHA and a POST to a FlowCMS
    // route. Publishing `flowcms/theme` meant either shipping a copy of the
    // admin component library to every theme author or admitting the export was
    // not package-safe. It was not.
    //
    // Nothing a theme could do is lost: core renders the form and hands it over
    // as `BlogPostView.askQuestion`, so the placement decision — the only part
    // a theme ever wanted — is still the theme's. The CAPTCHA and the
    // rate-limited submit path stay inside core, where a theme cannot weaken
    // them, which is a stronger boundary than the export was.
    expect(contract).not.toHaveProperty("AskQuestionForm")
  })

  it("exposes the settings authoring helpers", () => {
    expect(typeof contract.defineThemeSettings).toBe("function")
    expect(typeof contract.themeSettingsOf).toBe("function")
  })

  it("exposes the version a theme's flowcmsCompat is evaluated against", () => {
    expect(contract.FLOWCMS_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it("names every dispatchable surface", () => {
    expect([...contract.THEME_SURFACES]).toEqual([
      "Home",
      "Page",
      "BlogIndex",
      "BlogPost",
      "CategoryArchive",
      "TagArchive",
      "AuthorArchive",
      "NotFound",
    ])
  })
})

describe("the contract does not leak internal paths", () => {
  it("is reachable under the package specifier a published theme would use", async () => {
    // `flowcms/theme` is aliased in tsconfig.json and vitest.config.ts. If the
    // alias were dropped, every package theme would stop resolving — and the
    // failure would appear in somebody else's repository, not this one.
    const viaPackageSpecifier = await import("flowcms/theme")
    expect(Object.keys(viaPackageSpecifier).sort()).toEqual(PUBLIC_VALUE_EXPORTS)
  })
})
