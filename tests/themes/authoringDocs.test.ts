import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import * as contract from "@/Themes/contract"
import { manifest, auroraSettings } from "@example/flowcms-theme-aurora"
import { validateManifest } from "@/Themes/validation/manifest"
import {
  validateSettingsDefinition,
} from "@/Themes/validation/settingsDefinition"

/**
 * The theme author guide, checked against the code it documents.
 *
 * Documentation drift is not a cosmetic problem here: `docs/themes/authoring.md`
 * is what a third-party developer builds against, and a renamed export makes
 * every example in it wrong in somebody else's repository, where nothing in
 * this build would notice.
 *
 * This is NOT a documentation compiler. It checks the two things that actually
 * rot — identifiers that no longer exist, and examples that no longer validate —
 * and leaves prose alone.
 */

const GUIDE = readFileSync(join(process.cwd(), "docs/themes/authoring.md"), "utf8")

describe("the guide exists and covers the contract", () => {
  it.each([
    "trusted-code model",
    "Installation vs activation",
    "Package structure",
    "The manifest",
    "The required Layout",
    "Optional surfaces and fallback",
    "View models are the public data API",
    "SEO belongs to core",
    "Menus",
    "Theme settings",
    "Assets",
    "Styling",
    // Renamed in Phase 7.2: registering is one of three installation steps now,
    // and the section covers all three rather than just the registry entry.
    "Installing your theme into a site",
    "Common mistakes",
    "Compatibility policy",
  ])("has a section on %s", (heading) => {
    expect(GUIDE.toLowerCase()).toContain(heading.toLowerCase())
  })

  it("states plainly that FlowCMS does not sandbox theme code", () => {
    // The single most important sentence in the document. If it is softened,
    // an operator could reasonably conclude that installing a theme is safe in
    // a way it is not.
    expect(GUIDE).toMatch(/does not sandbox theme code/i)
    expect(GUIDE).toMatch(/server-side application code/i)
  })

  it("does not call themes plugins or promise runtime loading", () => {
    expect(GUIDE).toMatch(/not a plugin/i)
    expect(GUIDE).toMatch(/no plugin system/i)
    // "runtime theme loading" appears only in the list of what v0.1 excludes.
    expect(GUIDE).toMatch(/No runtime theme loading/i)
  })

  it("does not hardcode the default admin path in any instruction", () => {
    // The admin path is runtime-configurable; a doc that says "/admin" is wrong
    // for every operator who moved it.
    expect(GUIDE).not.toMatch(/\/admin\/appearance/)
    expect(GUIDE).not.toMatch(/localhost:3000\/admin/)
  })
})

describe("every contract identifier the guide names actually exists", () => {
  /** Value exports the guide lists in its public-surface table. */
  const DOCUMENTED_VALUES = [
    "JsonLd",
    "publicImageUrl",
    "publicImagePath",
    "howToStepAnchor",
    "readingTimeMinutes",
    "cn",
    "FLOWCMS_VERSION",
    "defineThemeSettings",
    "themeSettingsOf",
    "THEME_SURFACES",
  ]

  it.each(DOCUMENTED_VALUES)("%s is exported by the contract", (name) => {
    expect(contract).toHaveProperty(name)
  })

  it.each(DOCUMENTED_VALUES)("%s is named in the guide", (name) => {
    expect(GUIDE).toContain(name)
  })

  it("names every dispatchable surface, and no invented one", () => {
    for (const surface of contract.THEME_SURFACES) {
      expect(GUIDE, surface).toContain(surface)
    }
  })

  it("lists exactly the supported settings field types", () => {
    // A guide that promised a field type core cannot render would produce a
    // theme that fails registry validation.
    expect(GUIDE).toMatch(/`text`, `textarea`, `boolean`, `number`, `select`, `color`/)
    for (const invented of ["repeater", "richtext", "image-picker", "group"]) {
      expect(GUIDE.toLowerCase()).not.toContain(`\`${invented}\``)
    }
  })
})

describe("the example package the guide points at is real", () => {
  it("has a manifest that passes core's own validator", () => {
    expect(validateManifest(manifest).ok).toBe(true)
  })

  it("has a settings definition that passes core's own validator", () => {
    expect(validateSettingsDefinition(auroraSettings).ok).toBe(true)
  })

  it("matches the manifest fields the guide shows", () => {
    // The guide prints this manifest verbatim. If the package changes, the
    // sample is stale.
    expect(GUIDE).toContain(`slug: "${manifest.slug}"`)
    expect(GUIDE).toContain(`flowcmsCompat: "${manifest.flowcmsCompat}"`)
    expect(GUIDE).toContain(JSON.stringify(manifest.menuSlots).replace(/","/g, '", "'))
  })

  it("matches the settings version the guide's version table cites", () => {
    expect(GUIDE).toMatch(new RegExp(`\`${auroraSettings.version}\`\\s*\\|\\s*\`settings.version\``))
  })

  it("is the package the guide tells authors to copy", () => {
    expect(GUIDE).toContain("packages/flowcms-theme-aurora")
  })
})
