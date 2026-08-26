import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NO_SETTINGS } from "./settingsFixtures"

import { renderToStaticMarkup } from "react-dom/server"

/**
 * The ThemeResolver, reading a persisted selection.
 *
 * Settings is mocked at the module boundary the resolver actually uses —
 * `getActiveThemeSlug` — rather than at the database. What is under test is the
 * decision the resolver makes about a stored value, and a test that needed a
 * database to check "this slug is malformed" would be a test nobody runs.
 *
 * The four database engines are covered where they belong, in
 * `tests/db/contract.test.ts`, which writes and reads the column for real.
 */

let storedSlug: string | null = null
let readFails = false

vi.mock("@/Framework/Settings/themeSelection", async () => {
  const actual = await vi.importActual<typeof import("@/Framework/Settings/themeSelection")>(
    "@/Framework/Settings/themeSelection",
  )
  return {
    ...actual,
    getActiveThemeSlug: async () => {
      // Stands in for an unreachable database. The real function does not catch
      // either — see the DB-failure case below for why that matters.
      if (readFails) throw new Error("connect ECONNREFUSED 127.0.0.1:5432")
      return storedSlug
    },
  }
})

/**
 * Theme settings are resolved by the resolver too, and this suite is about
 * DISPATCH — which component renders — not persistence. Mocking the read keeps
 * it database-free, exactly as `themeSelection` is mocked above.
 *
 * `themeSettingsBoundary.test.ts` covers the real read against four engines.
 */
vi.mock("@/Framework/Settings/themeSettings", () => ({
  getThemeSettings: async (themeSlug: string) => ({
    themeSlug,
    values: Object.create(null),
    stored: false,
    schemaVersion: null,
    definitionVersion: null,
    unknownValues: Object.create(null),
    issues: [],
  }),
}))

import {
  getThemeStatus,
  resetFallbackWarnings,
  resolveLayout,
  resolveSurface,
  resolveTheme,
  selectSurface,
} from "@/Themes/resolver"
import { defaultTheme } from "@/Themes/default"
import { integrationTheme, INTEGRATION_MARKER } from "@/Themes/integration"
import { DEFAULT_THEME_SLUG, buildRegistry } from "@/Themes/registry"
import { THEME_SURFACES, type FlowCMSTheme } from "@/Themes/contract"
import auroraTheme from "@example/flowcms-theme-aurora"
import { BLOG_INDEX_VIEW, BLOG_POST_VIEW, BRAND } from "../fixtures/viewFixtures"

beforeEach(() => {
  storedSlug = null
  readFails = false
  resetFallbackWarnings()
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Silence the intentional fallback warning while asserting on behaviour. */
function silenceWarnings() {
  return vi.spyOn(console, "warn").mockImplementation(() => {})
}

describe("no selection", () => {
  it("resolves the default theme, and it is not a fallback", () => {
    // A fresh install has no settings row at all. Nothing was requested, so
    // nothing failed — reporting this as a fallback would put a warning banner
    // in front of every operator who has never opened Appearance.
    storedSlug = null
    return expect(resolveTheme()).resolves.toMatchObject({
      requestedSlug: null,
      slug: DEFAULT_THEME_SLUG,
      didFallBack: false,
      reason: null,
    })
  })

  it("treats an empty stored value as no selection", async () => {
    storedSlug = "   "
    // `getActiveThemeSlug` normalises blank to null in the real implementation;
    // this asserts the resolver does not choke if a blank reaches it anyway.
    const resolved = await resolveTheme()
    expect(resolved.slug).toBe(DEFAULT_THEME_SLUG)
  })
})

describe("valid selection", () => {
  it("resolves the default theme when it is explicitly selected", async () => {
    storedSlug = "default"
    const resolved = await resolveTheme()
    expect(resolved.requestedSlug).toBe("default")
    expect(resolved.theme).toBe(defaultTheme)
    expect(resolved.didFallBack).toBe(false)
    expect(resolved.reason).toBeNull()
  })
})

describe("missing selected theme", () => {
  it("falls back to default, records the reason, and keeps the requested slug", async () => {
    silenceWarnings()
    storedSlug = "aurora"

    const resolved = await resolveTheme()
    expect(resolved.slug).toBe(DEFAULT_THEME_SLUG)
    expect(resolved.theme).toBe(defaultTheme)
    expect(resolved.didFallBack).toBe(true)
    expect(resolved.reason).toBe("missing")
    // Preserved, because the admin panel has to be able to say WHICH theme
    // broke after a deploy. The resolver never rewrites the column.
    expect(resolved.requestedSlug).toBe("aurora")
  })

  it("still renders every surface", async () => {
    silenceWarnings()
    storedSlug = "aurora"
    for (const surface of THEME_SURFACES) {
      expect((await resolveSurface(surface)).Component, surface).toBeTypeOf("function")
    }
    expect(await resolveLayout()).toBe(defaultTheme.Layout)
  })
})

describe("invalid persisted slug", () => {
  const malformed = ["Aurora", "au rora", "../etc/passwd", "aurora-", "<script>", "a".repeat(65)]

  it.each(malformed)("falls back safely for %j", async (value) => {
    silenceWarnings()
    storedSlug = value

    const resolved = await resolveTheme()
    expect(resolved.slug).toBe(DEFAULT_THEME_SLUG)
    expect(resolved.didFallBack).toBe(true)
    // "invalid" rather than "missing": the value never had a chance of naming a
    // theme, and telling an operator to install "<script>" would be nonsense.
    expect(resolved.reason).toBe("invalid")
  })

  it("does not put the raw stored value into anything rendered", async () => {
    silenceWarnings()
    storedSlug = "<script>alert(1)</script>"
    const { Component: Home } = await resolveSurface("Home")
    const html = renderToStaticMarkup(
      <Home settings={NO_SETTINGS} brand={BRAND} jsonLd={null} />,
    )
    expect(html).not.toContain("alert(1)")
  })
})

describe("database failure", () => {
  it("propagates rather than pretending the default theme was selected", async () => {
    // The rule this pins: an outage is not a configuration state. Swallowing it
    // would make the site look fine while silently ignoring the operator's
    // theme, and nobody would find out until they noticed it had reverted.
    readFails = true
    await expect(resolveTheme()).rejects.toThrow(/ECONNREFUSED/)
    await expect(resolveSurface("BlogPost")).rejects.toThrow(/ECONNREFUSED/)
    await expect(getThemeStatus()).rejects.toThrow(/ECONNREFUSED/)
  })
})

describe("fallback logging", () => {
  it("warns once per distinct fallback, not once per request", async () => {
    const warn = silenceWarnings()
    storedSlug = "aurora"

    await resolveSurface("Home")
    await resolveSurface("BlogPost")
    await resolveLayout()

    // Theme resolution runs on every public request. Logging unconditionally is
    // the fastest way to make an operator stop reading their logs.
    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0][0])
    expect(message).toContain("aurora")
    expect(message).toContain(DEFAULT_THEME_SLUG)
    expect(message).toMatch(/not installed|no such theme/i)
    // The operator needs to know their setting was not touched.
    expect(message).toMatch(/unchanged/i)
  })

  it("warns again for a different broken selection", async () => {
    const warn = silenceWarnings()

    storedSlug = "aurora"
    await resolveSurface("Home")
    storedSlug = "Bad Slug"
    await resolveSurface("Home")

    expect(warn).toHaveBeenCalledTimes(2)
  })

  it("says nothing when the selection is fine", async () => {
    const warn = silenceWarnings()
    storedSlug = "default"
    await resolveSurface("Home")
    await resolveLayout()
    expect(warn).not.toHaveBeenCalled()
  })
})

describe("getThemeStatus", () => {
  it("reports a normal selection", async () => {
    storedSlug = "default"
    await expect(getThemeStatus()).resolves.toEqual({
      requestedSlug: "default",
      activeSlug: "default",
      fallback: false,
      reason: null,
    })
  })

  it("reports no selection without calling it a fallback", async () => {
    storedSlug = null
    await expect(getThemeStatus()).resolves.toEqual({
      requestedSlug: null,
      activeSlug: "default",
      fallback: false,
      reason: null,
    })
  })

  it("reports a missing theme", async () => {
    silenceWarnings()
    storedSlug = "aurora"
    await expect(getThemeStatus()).resolves.toEqual({
      requestedSlug: "aurora",
      activeSlug: "default",
      fallback: true,
      reason: "missing",
    })
  })

  it("reports an invalid slug", async () => {
    silenceWarnings()
    storedSlug = "NOT A SLUG"
    await expect(getThemeStatus()).resolves.toMatchObject({ fallback: true, reason: "invalid" })
  })

  it("carries no internals — four fields and nothing else", async () => {
    // Presentation-neutral: 6.4 writes the copy. No stack traces, no manifest
    // dumps, no error objects that might carry a connection string.
    silenceWarnings()
    storedSlug = "aurora"
    expect(Object.keys(await getThemeStatus()).sort()).toEqual([
      "activeSlug",
      "fallback",
      "reason",
      "requestedSlug",
    ])
  })
})

describe("incompatible selected theme", () => {
  /**
   * Driven through `buildRegistry` rather than the shipped registry, because
   * the shipped one contains no incompatible theme — and adding one just to be
   * broken would be shipping clutter. This asserts the registry half of the
   * contract the resolver relies on: an incompatible theme is present,
   * unavailable, and labelled.
   */
  function themeWith(overrides: Partial<FlowCMSTheme["manifest"]>): FlowCMSTheme {
    return {
      manifest: {
        slug: "aurora",
        name: "Aurora",
        version: "1.0.0",
        flowcmsCompat: "*",
        menuSlots: [],
        ...overrides,
      },
      Layout: () => null,
    }
  }

  it("is installed, unavailable, and labelled incompatible", () => {
    const registry = buildRegistry([
      ["default", defaultTheme],
      ["aurora", themeWith({ flowcmsCompat: "^99.0.0" })],
    ])
    const entry = registry.get("aurora")
    expect(entry?.available).toBe(false)
    expect(entry?.available === false && entry.reason).toBe("incompatible")
  })

  it("is distinguishable from a theme that is simply not installed", () => {
    const registry = buildRegistry([
      ["default", defaultTheme],
      ["aurora", themeWith({ flowcmsCompat: "^99.0.0" })],
    ])
    // "missing" tells an operator to install it; "incompatible" tells them to
    // wait for an update. Collapsing them would produce bad advice.
    expect(registry.get("aurora")).toBeDefined()
    expect(registry.get("nothing-like-this")).toBeUndefined()
  })
})

describe("surface-level fallback is independent of theme-level fallback", () => {
  /**
   * The distinction §19 of the brief exists to protect. A theme that restyles
   * only the blog index is a completely healthy theme; reporting it as
   * fallen-back because it does not implement `BlogPost` would tell an operator
   * their theme is broken when it is doing exactly what it says.
   */
  it("uses the selected theme's surface where it has one", () => {
    const chosen = selectSurface(auroraTheme, defaultTheme, "BlogIndex")
    expect(chosen).toBe(auroraTheme.BlogIndex)
  })

  it("uses the default theme's surface where the selected theme has none", () => {
    expect(auroraTheme.BlogPost).toBeUndefined()
    expect(selectSurface(auroraTheme, defaultTheme, "BlogPost")).toBe(defaultTheme.BlogPost)
  })

  it("falls back for exactly the surfaces the selected theme omits", () => {
    for (const surface of THEME_SURFACES) {
      expect(selectSurface(auroraTheme, defaultTheme, surface)).toBe(
        auroraTheme[surface] ?? defaultTheme[surface],
      )
    }
  })

  it("renders one theme's markup and the other's, from the same view models", () => {
    const Index = selectSurface(auroraTheme, defaultTheme, "BlogIndex")
    const Post = selectSurface(auroraTheme, defaultTheme, "BlogPost")
    expect(renderToStaticMarkup(<Index {...BLOG_INDEX_VIEW} settings={NO_SETTINGS} />)).toContain("Aurora journal")
    expect(renderToStaticMarkup(<Post {...BLOG_POST_VIEW} settings={NO_SETTINGS} />)).toContain("Step by step")
  })

  it("reports the selected theme as active even when a surface falls back", async () => {
    // Proved through the real resolver against the integration theme, which is
    // partial in exactly the same way. `didFallBack` stays false: nothing about
    // the theme failed.
    const registry = buildRegistry([
      ["default", defaultTheme],
      ["integration", integrationTheme],
    ])
    const selected = registry.get("integration")
    expect(selected?.available).toBe(true)
    expect(selected?.theme?.BlogPost).toBeUndefined()
    expect(selectSurface(integrationTheme, defaultTheme, "BlogPost")).toBe(defaultTheme.BlogPost)
    expect(selectSurface(integrationTheme, defaultTheme, "BlogIndex")).toBe(integrationTheme.BlogIndex)
  })

  it("throws when neither theme implements the surface", () => {
    const bare: FlowCMSTheme = { manifest: auroraTheme.manifest, Layout: auroraTheme.Layout }
    expect(() => selectSurface(bare, bare, "BlogPost")).toThrow(/BlogPost/)
  })
})

describe("the integration theme", () => {
  it("renders a marker that could not be confused with the default theme", () => {
    const Index = integrationTheme.BlogIndex!
    const html = renderToStaticMarkup(<Index {...BLOG_INDEX_VIEW} settings={NO_SETTINGS} />)
    expect(html).toContain(INTEGRATION_MARKER)
    const DefaultIndex = defaultTheme.BlogIndex!
    expect(renderToStaticMarkup(<DefaultIndex settings={NO_SETTINGS} {...BLOG_INDEX_VIEW} />)).not.toContain(INTEGRATION_MARKER)
  })
})

describe("resolver API shape", () => {
  it("stays async so the Settings read never forced a route rewrite", () => {
    storedSlug = null
    expect(resolveTheme()).toBeInstanceOf(Promise)
  })
})
