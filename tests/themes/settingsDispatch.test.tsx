// MUST be first: it registers the integration theme before the registry is built.
import "./integrationEnv"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * WHICH THEME'S SETTINGS REACH THE COMPONENT THAT ACTUALLY RENDERS.
 *
 * This is the subtle interaction in Phase 6.6 and the one most likely to be got
 * wrong, because two independent fallbacks are in play:
 *
 *   THEME-LEVEL fallback — the selected theme is unusable, so the DEFAULT theme
 *   renders everything. Every component is the default theme's, so every
 *   component gets the DEFAULT theme's settings.
 *
 *   SURFACE-LEVEL fallback — the selected theme is fine but does not implement
 *   `BlogPost`, so the default theme's `BlogPost` renders inside the SELECTED
 *   theme's Layout. Two different themes' components are on the page at once,
 *   and each must receive its OWN theme's settings. Handing the default's
 *   `BlogPost` a set of integration keys would be one theme's namespace leaking
 *   into another's component.
 *
 * The rule: settings follow the IMPLEMENTATION, not the selection.
 */

let storedSlug: string | null = null

vi.mock("@/Framework/Settings/themeSelection", async () => {
  const actual = await vi.importActual<typeof import("@/Framework/Settings/themeSelection")>(
    "@/Framework/Settings/themeSelection",
  )
  return { ...actual, getActiveThemeSlug: async () => storedSlug }
})

/**
 * Stands in for the database. Each theme gets a recognisably different value so
 * a swap is visible rather than merely wrong.
 */
const VALUES: Record<string, Record<string, string | number | boolean>> = {
  default: { showTagline: true, layoutWidth: "wide", accentColor: "#111111" },
  integration: { markerSuffix: "FROM-INTEGRATION", showBanner: true },
}

const requested: string[] = []

vi.mock("@/Framework/Settings/themeSettings", () => ({
  getThemeSettings: async (themeSlug: string) => {
    requested.push(themeSlug)
    return {
      themeSlug,
      values: VALUES[themeSlug] ?? {},
      stored: true,
      schemaVersion: 1,
      definitionVersion: 1,
      unknownValues: {},
      issues: [],
    }
  },
}))

import { resolveSurface, resolveLayoutAndSlots, selectSurfaceEntry } from "@/Themes/resolver"
import { defaultTheme } from "@/Themes/default"
import { integrationTheme } from "@/Themes/integration"
import { BLOG_INDEX_VIEW, BLOG_POST_VIEW } from "../fixtures/viewFixtures"

const BRAND = { siteName: "FlowCMS", tagline: "A tagline", logoUrl: null, logoAltText: null }
const NAV = { slots: {} }

beforeEach(() => {
  storedSlug = null
  requested.length = 0
})

describe("selectSurfaceEntry reports the implementing theme", () => {
  it("names the selected theme when it implements the surface", () => {
    const { owner } = selectSurfaceEntry(integrationTheme, defaultTheme, "BlogIndex")
    expect(owner.manifest.slug).toBe("integration")
  })

  it("names the DEFAULT theme when the surface falls back", () => {
    // The integration theme implements Layout and BlogIndex only.
    const { owner } = selectSurfaceEntry(integrationTheme, defaultTheme, "BlogPost")
    expect(owner.manifest.slug).toBe("default")
  })
})

describe("surface-level fallback — integration selected, BlogPost falls back", () => {
  beforeEach(() => {
    storedSlug = "integration"
  })

  it("gives the integration Layout the INTEGRATION settings", async () => {
    const { settings } = await resolveLayoutAndSlots()
    expect(settings).toEqual(VALUES.integration)
  })

  it("gives the integration BlogIndex the INTEGRATION settings", async () => {
    const { settings } = await resolveSurface("BlogIndex")
    expect(settings).toEqual(VALUES.integration)
  })

  it("gives the fallen-back BlogPost the DEFAULT theme's settings", async () => {
    // The component is the default theme's, so the settings are too.
    const { Component, settings } = await resolveSurface("BlogPost")
    expect(Component).toBe(defaultTheme.BlogPost)
    expect(settings).toEqual(VALUES.default)
  })

  it("never hands a default-theme component an integration-only key", async () => {
    const { settings } = await resolveSurface("BlogPost")
    expect("markerSuffix" in settings).toBe(false)
    expect("showBanner" in settings).toBe(false)
  })

  it("never hands an integration component a default-only key", async () => {
    const { settings } = await resolveSurface("BlogIndex")
    expect("layoutWidth" in settings).toBe(false)
    expect("showTagline" in settings).toBe(false)
  })

  it("renders both namespaces correctly on one page", async () => {
    const { Layout, settings: layoutSettings } = await resolveLayoutAndSlots()
    const { Component: BlogPost, settings: postSettings } = await resolveSurface("BlogPost")

    const html = renderToStaticMarkup(
      <Layout brand={BRAND} nav={NAV} settings={layoutSettings}>
        <BlogPost {...BLOG_POST_VIEW} settings={postSettings} />
      </Layout>,
    )

    // The integration Layout's own setting shows up…
    expect(html).toContain("FROM-INTEGRATION")
    // …and the default BlogPost rendered inside it, without a crash and
    // without integration keys.
    expect(html).toContain(BLOG_POST_VIEW.post.title)
  })

  it("asks for each theme's settings by name", async () => {
    await resolveLayoutAndSlots()
    await resolveSurface("BlogPost")
    expect(requested).toContain("integration")
    expect(requested).toContain("default")
  })
})

describe("whole-theme fallback — selected theme is missing", () => {
  beforeEach(() => {
    storedSlug = "aurora-nightfall"
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  it("gives the Layout the DEFAULT theme's settings", async () => {
    const { settings } = await resolveLayoutAndSlots()
    expect(settings).toEqual(VALUES.default)
  })

  it("gives every surface the DEFAULT theme's settings", async () => {
    for (const surface of ["Home", "BlogIndex", "BlogPost", "Page"] as const) {
      const { settings } = await resolveSurface(surface)
      expect(settings, surface).toEqual(VALUES.default)
    }
  })

  it("never asks for the missing theme's settings", async () => {
    await resolveLayoutAndSlots()
    await resolveSurface("BlogIndex")
    expect(requested).not.toContain("aurora-nightfall")
  })
})

describe("no selection — the default theme renders", () => {
  it("uses the default theme's settings throughout", async () => {
    storedSlug = null
    const { settings: layout } = await resolveLayoutAndSlots()
    const { settings: index } = await resolveSurface("BlogIndex")
    expect(layout).toEqual(VALUES.default)
    expect(index).toEqual(VALUES.default)
  })
})

describe("settings actually change what a visitor sees", () => {
  it("the default Layout honours its own settings", async () => {
    storedSlug = null
    const { Layout, settings } = await resolveLayoutAndSlots()
    const html = renderToStaticMarkup(
      <Layout brand={BRAND} nav={NAV} settings={settings}>
        <p>body</p>
      </Layout>,
    )
    // showTagline: true
    expect(html).toContain("A tagline")
    // layoutWidth: wide
    expect(html).toContain("max-w-7xl")
    // accentColor
    expect(html).toContain("#111111")
  })

  it("the integration BlogIndex renders inside a Layout carrying its suffix", async () => {
    storedSlug = "integration"
    const { Layout, settings } = await resolveLayoutAndSlots()
    const { Component: BlogIndex, settings: indexSettings } = await resolveSurface("BlogIndex")

    const html = renderToStaticMarkup(
      <Layout brand={BRAND} nav={NAV} settings={settings}>
        <BlogIndex {...BLOG_INDEX_VIEW} settings={indexSettings} />
      </Layout>,
    )
    expect(html).toContain("flowcms-integration-theme:FROM-INTEGRATION")
  })
})
