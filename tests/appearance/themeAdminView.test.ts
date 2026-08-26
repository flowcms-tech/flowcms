import { describe, expect, it } from "vitest"
import { buildThemeAdminView, safeScreenshotPath } from "@/Modules/Appearance/Values/themeAdminView"
import type { InstalledTheme } from "@/Themes/registry"
import type { ThemeStatus } from "@/Themes/resolver"
import type { FlowCMSTheme, ThemeManifest } from "@/Themes/contract"

/**
 * The model the Appearance screen renders from.
 *
 * Pure, and that is the point: it takes registry entries and a theme status as
 * arguments rather than reaching for either, so every operator-visible state —
 * including the ones that only occur after a bad deploy — can be constructed in
 * a test instead of waited for in production.
 *
 * It is also the serialization boundary. The registry holds React components
 * and functions; what crosses to the client must be metadata and nothing else.
 */

function manifest(overrides: Partial<ThemeManifest> = {}): ThemeManifest {
  return {
    slug: "aurora",
    name: "Aurora",
    version: "2.1.0",
    flowcmsCompat: "^0.1.0",
    menuSlots: ["primary", "footer"],
    ...overrides,
  }
}

function available(overrides: Partial<ThemeManifest> = {}): InstalledTheme {
  const m = manifest(overrides)
  return {
    slug: m.slug,
    available: true,
    theme: { manifest: m, Layout: () => null } as FlowCMSTheme,
  }
}

function unavailable(
  reason: "invalid" | "incompatible",
  overrides: Partial<ThemeManifest> = {},
): InstalledTheme {
  const m = manifest(overrides)
  return { slug: m.slug, available: false, theme: null, reason, problems: ["a problem"] }
}

const DEFAULT_ENTRY = available({ slug: "default", name: "FlowCMS Default", version: "1.0.0" })

function status(overrides: Partial<ThemeStatus> = {}): ThemeStatus {
  return { requestedSlug: null, activeSlug: "default", fallback: false, reason: null, ...overrides }
}

describe("no explicit selection — the fresh-install state", () => {
  const view = buildThemeAdminView([DEFAULT_ENTRY], status())

  it("shows the default theme as rendering", () => {
    const card = view.themes[0]
    expect(card.slug).toBe("default")
    expect(card.rendering).toBe(true)
  })

  it("does not claim the default was explicitly requested", () => {
    // `requested` is persisted operator intent. Nobody chose this.
    expect(view.themes[0].requested).toBe(false)
  })

  it("raises no warning, because nothing is wrong", () => {
    expect(view.fallback).toBeNull()
  })

  it("offers no Activate button for the theme already rendering", () => {
    expect(view.themes[0].canActivate).toBe(false)
  })
})

describe("a theme is explicitly selected and rendering", () => {
  const view = buildThemeAdminView(
    [DEFAULT_ENTRY, available()],
    status({ requestedSlug: "aurora", activeSlug: "aurora" }),
  )
  const aurora = view.themes.find((t) => t.slug === "aurora")!
  const dflt = view.themes.find((t) => t.slug === "default")!

  it("marks it both requested and rendering", () => {
    expect(aurora.requested).toBe(true)
    expect(aurora.rendering).toBe(true)
  })

  it("does not also mark the default as rendering", () => {
    // Two cards labelled "Active" is the confusion §28 exists to prevent.
    expect(dflt.rendering).toBe(false)
    expect(dflt.requested).toBe(false)
  })

  it("offers the default as something to switch back to", () => {
    expect(dflt.canActivate).toBe(true)
  })

  it("carries the manifest metadata an operator needs", () => {
    expect(aurora).toMatchObject({ name: "Aurora", version: "2.1.0", menuSlots: ["primary", "footer"] })
  })
})

describe("selected theme is missing from this build", () => {
  const view = buildThemeAdminView(
    [DEFAULT_ENTRY],
    status({ requestedSlug: "aurora", activeSlug: "default", fallback: true, reason: "missing" }),
  )

  it("reports the fallback with the requested slug and a reason", () => {
    expect(view.fallback).toMatchObject({ requestedSlug: "aurora", reason: "missing" })
  })

  it("renders the default as rendering but NOT as requested", () => {
    const dflt = view.themes[0]
    expect(dflt.rendering).toBe(true)
    expect(dflt.requested).toBe(false)
  })

  it("invents no card for the missing theme", () => {
    // There is no manifest, so there is no version, author or description. A
    // card built from nothing would be fabricated metadata.
    expect(view.themes.map((t) => t.slug)).toEqual(["default"])
  })

  it("lets the operator activate the default to clear the stale selection", () => {
    expect(view.themes[0].canActivate).toBe(true)
  })
})

describe("selected theme is installed but unavailable", () => {
  it("keeps an incompatible theme visible and explains why", () => {
    const view = buildThemeAdminView(
      [DEFAULT_ENTRY, unavailable("incompatible")],
      status({ requestedSlug: "aurora", activeSlug: "default", fallback: true, reason: "incompatible" }),
    )
    const aurora = view.themes.find((t) => t.slug === "aurora")!

    // Hiding it would leave an operator unable to understand why their site
    // changed after an upgrade.
    expect(aurora.available).toBe(false)
    expect(aurora.availabilityReason).toBe("incompatible")
    expect(aurora.canActivate).toBe(false)
    expect(aurora.requested).toBe(true)
    expect(aurora.rendering).toBe(false)
  })

  it("keeps an invalid theme visible with its own distinct reason", () => {
    // "incompatible" means wait for an update; "invalid" means the package is
    // broken. Collapsing them into one generic error produces bad advice.
    const view = buildThemeAdminView(
      [DEFAULT_ENTRY, unavailable("invalid")],
      status({ requestedSlug: "aurora", activeSlug: "default", fallback: true, reason: "invalid" }),
    )
    expect(view.themes.find((t) => t.slug === "aurora")!.availabilityReason).toBe("invalid")
  })

  it("does not offer to activate an unavailable theme even when it is requested", () => {
    const view = buildThemeAdminView(
      [DEFAULT_ENTRY, unavailable("incompatible")],
      status({ requestedSlug: "aurora", activeSlug: "default", fallback: true, reason: "incompatible" }),
    )
    expect(view.themes.find((t) => t.slug === "aurora")!.canActivate).toBe(false)
  })
})

describe("the client receives metadata and nothing else", () => {
  it("carries no component, no manifest object, no registry entry", () => {
    const view = buildThemeAdminView([DEFAULT_ENTRY, available()], status())
    const serialized = JSON.stringify(view)

    // The strongest available check: if a function or component survived, the
    // round trip through JSON would drop it and the structures would differ.
    expect(JSON.parse(serialized)).toEqual(view)
    for (const card of view.themes) {
      expect(card).not.toHaveProperty("theme")
      expect(card).not.toHaveProperty("Layout")
      expect(card).not.toHaveProperty("problems")
    }
  })

  it("does not leak the registry's internal problem strings", () => {
    // They are authored for a build log, not for an operator, and can name
    // internal paths.
    const view = buildThemeAdminView([DEFAULT_ENTRY, unavailable("invalid")], status())
    expect(JSON.stringify(view)).not.toContain("a problem")
  })
})

describe("ordering", () => {
  it("puts the rendering theme first, then the rest by name", () => {
    const view = buildThemeAdminView(
      [available({ slug: "zebra", name: "Zebra" }), DEFAULT_ENTRY, available()],
      status({ requestedSlug: "aurora", activeSlug: "aurora" }),
    )
    expect(view.themes.map((t) => t.slug)).toEqual(["aurora", "default", "zebra"])
  })
})

describe("safeScreenshotPath", () => {
  it.each([
    "screenshot.png",
    "assets/screenshot.png",
    "./screenshot.jpg",
  ])("accepts a bundled relative path %j", (value) => {
    expect(safeScreenshotPath(value)).not.toBeNull()
  })

  it.each([
    "/_next/static/media/aurora.9f3b1c.png",
    "/themes/aurora/screenshot.png",
  ])("accepts a same-origin absolute path %j", (value) => {
    // CHANGED IN PHASE 7.2, and it is a widening, so it deserves its reason.
    //
    // A leading slash used to be refused alongside remote URLs, under "absolute
    // paths escape the package". That conflated leaving the PACKAGE with
    // leaving the ORIGIN, and only the second is a risk — a scheme or a
    // protocol-relative prefix is what makes a URL remote, and both are still
    // refused below.
    //
    // Refusing "/" also made the field unusable for the only mechanism that
    // works. A theme installed in node_modules is not served by Next, and the
    // Appearance screen sits at a configurable admin path, so a page-relative
    // path resolves under whatever that happens to be. The supported route is a
    // static import in src/Themes/packages.ts, which yields
    // "/_next/static/media/…" — the first value above.
    //
    // What a same-origin path can do is request a URL on the operator's own
    // site from an <img> tag. A path that resolves to nothing 404s and the card
    // shows a broken image; it cannot read a file, reach another origin, or
    // execute anything.
    expect(safeScreenshotPath(value)).toBe(value)
  })

  it.each([
    ["path traversal", "../../etc/passwd"],
    ["a nested traversal", "assets/../../secret.png"],
    ["an absolute traversal", "/assets/../../secret.png"],
    ["a remote URL", "https://tracker.example/pixel.png"],
    ["a protocol-relative URL", "//tracker.example/pixel.png"],
    ["a javascript scheme", "javascript:alert(1)"],
    ["a data URL", "data:text/html,<script>alert(1)</script>"],
    ["a backslash path", "..\\..\\windows\\system32"],
    ["an empty value", "   "],
  ])("rejects %s", (_label, value) => {
    // A manifest is theme-author input. A screenshot field that accepted a
    // remote URL would let a theme phone home from every operator's admin
    // panel; one that accepted a traversal would read outside its own package.
    expect(safeScreenshotPath(value)).toBeNull()
  })

  it("returns null rather than throwing for a missing value", () => {
    expect(safeScreenshotPath(undefined)).toBeNull()
  })

  it("drops an unsafe screenshot from the card instead of rejecting the theme", () => {
    // A bad screenshot is a cosmetic problem. Refusing to list the theme over
    // one would hide a working theme for a broken image.
    const view = buildThemeAdminView(
      [DEFAULT_ENTRY, available({ screenshot: "https://tracker.example/p.png" })],
      status(),
    )
    expect(view.themes.find((t) => t.slug === "aurora")!.screenshot).toBeNull()
  })
})

describe("corrupt persisted slug", () => {
  it("passes the requested slug through untouched, for the UI to escape", () => {
    // Escaping belongs to the renderer. React escapes text children, so the
    // model must NOT pre-mangle the value — an operator needs to see what is
    // actually stored in order to fix it.
    const hostile = "<script>alert(1)</script>"
    const view = buildThemeAdminView(
      [DEFAULT_ENTRY],
      status({ requestedSlug: hostile, activeSlug: "default", fallback: true, reason: "invalid" }),
    )
    expect(view.fallback?.requestedSlug).toBe(hostile)
  })

  it("never turns a corrupt slug into a card", () => {
    const view = buildThemeAdminView(
      [DEFAULT_ENTRY],
      status({ requestedSlug: "<img onerror=x>", activeSlug: "default", fallback: true, reason: "invalid" }),
    )
    expect(view.themes.map((t) => t.slug)).toEqual(["default"])
  })
})
