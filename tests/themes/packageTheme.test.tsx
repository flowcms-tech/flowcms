import { describe, expect, it } from "vitest"
import { themeDefaults, NO_SETTINGS } from "./settingsFixtures"

import { renderToStaticMarkup } from "react-dom/server"


import "./integrationEnv"
import auroraTheme from "@example/flowcms-theme-aurora"
import { buildRegistry } from "@/Themes/registry"
import { THEME_SURFACES } from "@/Themes/contract"
import { validateTheme } from "@/Themes/validation/manifest"
import { BLOG_INDEX_VIEW, BRAND, SUMMARY } from "../fixtures/viewFixtures"
import { defaultTheme } from "@/Themes/default"

/**
 * A theme written the way a third party would write one.
 *
 * The default theme lives in this repository, so it proves nothing about
 * whether the contract is sufficient — it could reach past `flowcms/theme`
 * at any point and nobody would notice until somebody outside this repo tried
 * to write a theme, by which point the missing export would be a breaking
 * change to add.
 *
 * `packages/flowcms-theme-aurora/` is that outside party: its own package.json,
 * outside `src/`, importing FlowCMS only through `flowcms/theme`, with a
 * deliberately partial set of surfaces. Its package boundary is asserted in
 * `tests/architecture/packageBoundary.test.ts`; this file is about how it
 * BEHAVES once registered.
 */

describe("a partial theme", () => {
  it("validates with only a manifest and a Layout", () => {
    expect(validateTheme(auroraTheme).ok).toBe(true)
  })

  it("registers alongside the default theme", () => {
    const registry = buildRegistry([
      ["default", defaultTheme],
      ["aurora", auroraTheme],
    ])
    const entry = registry.get("aurora")
    expect(entry?.available).toBe(true)
    expect(entry?.theme?.manifest.name).toBe("Aurora")
  })

  it("implements some surfaces and not others", () => {
    const implemented = THEME_SURFACES.filter((surface) => auroraTheme[surface])
    const missing = THEME_SURFACES.filter((surface) => !auroraTheme[surface])
    expect(implemented).toContain("BlogIndex")
    // The case core's per-surface fallback exists to serve, wired in 6.2/6.3.
    // A fixture implementing everything would never exercise it.
    expect(missing.length).toBeGreaterThan(0)
    expect(missing).toContain("BlogPost")
  })

  it("declares a menu slot the default theme does not", () => {
    // Slot handling has to follow the manifest, not a list hardcoded in core.
    expect(auroraTheme.manifest.menuSlots).toEqual(["primary", "sidebar"])
    expect(defaultTheme.manifest.menuSlots).not.toContain("sidebar")
  })
})

describe("the package theme renders", () => {
  it("renders its Layout, including its own slot", () => {
    const html = renderToStaticMarkup(
      <auroraTheme.Layout settings={themeDefaults(auroraTheme.settings)}
        brand={BRAND}
        nav={{ slots: { sidebar: [{ label: "Archive", href: "/archive", opensInNewTab: false, children: [] }] } }}
      >
        <p>Body</p>
      </auroraTheme.Layout>,
    )
    expect(html).toContain("Example Site")
    expect(html).toContain("Archive")
    expect(html).toContain("Body")
  })

  it("renders its Layout with no menus and no tagline", () => {
    const html = renderToStaticMarkup(
      <auroraTheme.Layout settings={themeDefaults(auroraTheme.settings)} brand={{ ...BRAND, tagline: null }} nav={{ slots: {} }}>
        <p>Body</p>
      </auroraTheme.Layout>,
    )
    expect(html).toContain("Example Site")
    // The sidebar element is always present in Aurora's shell; what an empty
    // slot must not produce is a list.
    expect(html).not.toContain("<ul")
  })

  it("renders a blog index from the same view model the default theme takes", () => {
    // Same input, different markup: that is the entire promise of a theme
    // system, and it is checked rather than asserted in a comment.
    const BlogIndex = auroraTheme.BlogIndex!
    const html = renderToStaticMarkup(<BlogIndex settings={NO_SETTINGS} {...BLOG_INDEX_VIEW} />)
    expect(html).toContain("Aurora journal")
    expect(html).toContain(SUMMARY.title)
    expect(html).toContain("Page 1 of 3")

    const DefaultBlogIndex = defaultTheme.BlogIndex!
    const defaultHtml = renderToStaticMarkup(<DefaultBlogIndex {...BLOG_INDEX_VIEW} settings={NO_SETTINGS} />)
    expect(defaultHtml).toContain(SUMMARY.title)
    expect(defaultHtml).not.toContain("Aurora journal")
  })

  it("renders an empty blog index without inventing content", () => {
    const BlogIndex = auroraTheme.BlogIndex!
    const html = renderToStaticMarkup(
      <BlogIndex settings={NO_SETTINGS} {...BLOG_INDEX_VIEW} posts={[]} totalPages={0} />,
    )
    expect(html).toContain("Aurora journal")
    expect(html).not.toContain("<li>")
  })

  it("escapes JSON-LD through core, not through the theme", () => {
    // Aurora calls `<JsonLd>` and never touches JSON.stringify. A theme
    // that could serialize its own graph could reintroduce the injection the
    // custom page renderer once had.
    const BlogIndex = auroraTheme.BlogIndex!
    const html = renderToStaticMarkup(
      <BlogIndex settings={NO_SETTINGS} {...BLOG_INDEX_VIEW} jsonLd={{ name: "</scr" + "ipt><script>alert(1)" }} />,
    )
    expect(html).not.toContain("<script>alert(1)")
    expect(html).toContain("\\u003c")
  })
})
