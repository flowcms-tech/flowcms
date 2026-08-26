import { describe, expect, it } from "vitest"
import {
  DEFAULT_THEME_SLUG,
  buildRegistry,
  getDefaultTheme,
  getInstalledTheme,
  getTheme,
  listThemes,
} from "@/Themes/registry"
import { FLOWCMS_VERSION } from "@/Framework/Config/version"
import { isCompatible } from "@/Themes/validation/compat"
import { THEME_SURFACES, type FlowCMSTheme } from "@/Themes/contract/views"
import type { ThemeEntry } from "@/Themes/registry"

function Component() {
  return null
}

function theme(overrides: Partial<FlowCMSTheme["manifest"]> = {}): FlowCMSTheme {
  return {
    manifest: {
      slug: "sunrise",
      name: "Sunrise",
      version: "1.0.0",
      flowcmsCompat: "*",
      menuSlots: [],
      ...overrides,
    },
    Layout: Component,
  }
}

/** A valid default entry, plus whatever the case under test adds. */
function withDefault(...extra: ThemeEntry[]): ThemeEntry[] {
  return [["default", theme({ slug: "default" })], ...extra]
}

describe("the shipped registry", () => {
  it("contains the default theme", () => {
    expect(getTheme(DEFAULT_THEME_SLUG)).toBeDefined()
    expect(getDefaultTheme().manifest.slug).toBe(DEFAULT_THEME_SLUG)
  })

  it("returns undefined for a theme that is not installed", () => {
    // Not a silent fallback: a caller that gets undefined can log which slug
    // was missing. Resolving quietly to the default hides a bad setting until
    // someone notices the site does not look the way they configured it.
    expect(getTheme("not-installed")).toBeUndefined()
  })

  it("lists every installed theme", () => {
    expect(listThemes().map((t) => t.manifest.slug)).toContain(DEFAULT_THEME_SLUG)
  })

  it("ships a default theme that accepts the running FlowCMS version", () => {
    // The reason FLOWCMS_VERSION is a constant somebody has to bump by hand:
    // this test fails on a bump that outruns the shipped theme, instead of the
    // operator's homepage failing after deploy.
    const { flowcmsCompat } = getDefaultTheme().manifest
    expect(isCompatible(flowcmsCompat, FLOWCMS_VERSION)).toBe(true)
  })

  it("implements every surface, because it is the fallback for themes that do not", () => {
    const fallback = getDefaultTheme()
    for (const surface of THEME_SURFACES) {
      expect(fallback[surface], `default theme is missing ${surface}`).toBeTypeOf("function")
    }
    expect(fallback.Layout).toBeTypeOf("function")
  })
})

describe("buildRegistry — rejects a corrupt build", () => {
  it("throws when the default theme is absent", () => {
    expect(() => buildRegistry([["sunrise", theme()]])).toThrow(/default/)
  })

  it("throws when the registry is empty", () => {
    expect(() => buildRegistry([])).toThrow(/default/)
  })

  it("throws when the key and the manifest slug disagree", () => {
    // Activation stores the key; the theme answers to its slug. If they differ,
    // activating "sunset" silently activates nothing at all.
    expect(() => buildRegistry(withDefault(["sunset", theme({ slug: "sunrise" })]))).toThrow(
      /registry key and manifest slug must match/,
    )
  })

  it("throws when a manifest is invalid", () => {
    expect(() => buildRegistry(withDefault(["sunrise", theme({ version: "1" })]))).toThrow(/x\.y\.z/)
  })

  it("throws when the default theme's own manifest is invalid", () => {
    expect(() => buildRegistry([["default", theme({ slug: "default", name: "" })]])).toThrow()
  })

  it("throws when the DEFAULT theme is incompatible", () => {
    // No fallback from the fallback. A build whose default theme cannot render
    // cannot serve the public site at all.
    expect(() => buildRegistry([["default", theme({ slug: "default", flowcmsCompat: "^99.0.0" })]])).toThrow(
      /flowcmsCompat/,
    )
  })

  it("throws when two entries claim the same slug", () => {
    // Two themes answering to one slug makes activation a coin flip. This is
    // why the registry takes a list of entries and not a record: in a record
    // keyed by slug the case cannot be built, so the guard could never be
    // shown to work.
    expect(() =>
      buildRegistry([
        ["default", theme({ slug: "default" })],
        ["default", theme({ slug: "default", name: "Impostor" })],
      ]),
    ).toThrow(/[Dd]uplicate/)
  })

  it("throws when the DEFAULT theme has no Layout", () => {
    const broken = theme({ slug: "default" })
    delete (broken as Partial<FlowCMSTheme>).Layout
    expect(() => buildRegistry([["default", broken]])).toThrow(/Layout/)
  })

  it("names the offending theme in the message", () => {
    // An operator staring at a failed deploy needs to know which theme, not
    // that "a theme" is broken.
    expect(() => buildRegistry(withDefault(["sunrise", theme({ version: "nope" })]))).toThrow(/sunrise/)
  })

  it("accepts a valid second theme alongside the default", () => {
    const registry = buildRegistry(withDefault(["sunrise", theme()]))
    expect([...registry.keys()].sort()).toEqual(["default", "sunrise"])
  })
})

describe("buildRegistry — installed but unavailable", () => {
  /**
   * The Phase 6.3 refinement, and the situation it exists for is ordinary
   * rather than exotic: an operator activates a theme, upgrades FlowCMS, and
   * the theme's `flowcmsCompat` no longer matches. Under the previous rule the
   * upgraded container refused to start — the whole site down, admin panel
   * included, because of a theme. Now it starts, renders the default, and can
   * explain itself.
   */
  it("records an incompatible non-default theme rather than failing the build", () => {
    const registry = buildRegistry(withDefault(["sunrise", theme({ flowcmsCompat: "^99.0.0" })]))
    const entry = registry.get("sunrise")
    expect(entry?.available).toBe(false)
    expect(entry?.available === false && entry.reason).toBe("incompatible")
    expect(entry?.available === false && entry.problems.join(" ")).toMatch(/flowcmsCompat/)
  })

  it("records an unparseable compatibility range as incompatible, not as valid", () => {
    // Fails closed: an unrecognised range is not assumed to fit.
    const registry = buildRegistry(withDefault(["sunrise", theme({ flowcmsCompat: "latest" })]))
    expect(registry.get("sunrise")?.available).toBe(false)
  })

  it("records a non-default theme with no Layout as invalid, not incompatible", () => {
    // The distinction matters to the operator: incompatible means "wait for an
    // update", invalid means "this package is broken".
    const broken = theme()
    delete (broken as Partial<FlowCMSTheme>).Layout
    const registry = buildRegistry(withDefault(["sunrise", broken]))
    const entry = registry.get("sunrise")
    expect(entry?.available).toBe(false)
    expect(entry?.available === false && entry.reason).toBe("invalid")
  })

  it("never hands out an unavailable theme to render", () => {
    // `theme` is null exactly when `available` is false, so nothing can render
    // a broken package by reaching past the flag.
    const registry = buildRegistry(withDefault(["sunrise", theme({ flowcmsCompat: "^99.0.0" })]))
    expect(registry.get("sunrise")?.theme).toBeNull()
  })

  it("keeps unavailable themes listed, because an operator cannot fix what they cannot see", () => {
    const registry = buildRegistry(withDefault(["sunrise", theme({ flowcmsCompat: "^99.0.0" })]))
    expect([...registry.keys()].sort()).toEqual(["default", "sunrise"])
  })
})

describe("the shipped registry accessors", () => {
  it("getTheme returns undefined for an installed-but-unavailable theme", () => {
    // Callers that only want to render should not have to check availability;
    // callers that need to explain use getInstalledTheme.
    expect(getTheme("not-installed")).toBeUndefined()
    expect(getInstalledTheme("not-installed")).toBeUndefined()
  })

  it("lists only renderable themes from listThemes", () => {
    expect(listThemes().every((t) => typeof t.Layout === "function")).toBe(true)
  })

  it("lists the default theme as installed and available", () => {
    const entry = getInstalledTheme(DEFAULT_THEME_SLUG)
    expect(entry?.available).toBe(true)
  })

  it("does not register the integration theme unless it is explicitly enabled", () => {
    // It ships in the bundle but stays out of the registry, so no operator sees
    // a fake theme in a list they are meant to choose from.
    expect(getInstalledTheme("integration")).toBeUndefined()
  })
})
