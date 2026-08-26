import { describe, expect, it } from "vitest"
import { themeDefaults } from "../themes/settingsFixtures"

import { renderToStaticMarkup } from "react-dom/server"
import { defaultTheme } from "@/Themes/default"
import { integrationTheme, INTEGRATION_NAV_MARKER } from "@/Themes/integration"
import type { NavItem, NavView } from "@/Themes/contract/views"

/**
 * A theme receives the slots it declared, and no others.
 *
 * This is the mechanism the whole "menus survive a theme switch" claim rests
 * on. Nothing deletes or rewrites a menu when the active theme changes — the
 * shell simply asks for a different set of slot names, and a theme that does
 * not declare `footer` never sees the footer menu. Proving it at the RENDER
 * level rather than the query level is what makes it a statement about what a
 * visitor sees.
 */

function nav(items: Record<string, NavItem[]>): NavView {
  return { slots: items }
}

function item(label: string, href: string, children: NavItem[] = []): NavItem {
  return { label, href, opensInNewTab: false, children }
}

const BRAND = { siteName: "FlowCMS", tagline: null, logoUrl: null, logoAltText: null }

const FULL_NAV = nav({
  primary: [item("Home", "/"), item("Guides", "/blog/category/guides", [item("Locks", "/blog/locks")])],
  footer: [item("Privacy", "/privacy")],
})

describe("manifests declare the slots the shell will ask for", () => {
  it("the default theme declares primary and footer", () => {
    expect(defaultTheme.manifest.menuSlots).toEqual(["primary", "footer"])
  })

  it("the integration theme declares primary only", () => {
    expect(integrationTheme.manifest.menuSlots).toEqual(["primary"])
  })
})

describe("the default theme renders both of its slots", () => {
  const html = renderToStaticMarkup(
    <defaultTheme.Layout settings={themeDefaults(defaultTheme.settings)} brand={BRAND} nav={FULL_NAV}>
      <p>body</p>
    </defaultTheme.Layout>,
  )

  it("renders the primary items", () => {
    expect(html).toContain('href="/"')
    expect(html).toContain("Guides")
  })

  it("renders one level of children", () => {
    expect(html).toContain("Locks")
  })

  it("renders the footer items", () => {
    expect(html).toContain("Privacy")
  })
})

describe("the integration theme consumes only the slot it declared", () => {
  const html = renderToStaticMarkup(
    <integrationTheme.Layout settings={themeDefaults(integrationTheme.settings)} brand={BRAND} nav={FULL_NAV}>
      <p>body</p>
    </integrationTheme.Layout>,
  )

  it("renders its primary navigation", () => {
    expect(html).toContain(INTEGRATION_NAV_MARKER)
    expect(html).toContain("Guides")
  })

  it("does NOT render the footer menu, because it declares no footer slot", () => {
    // The footer menu is untouched in the database. It is simply not this
    // theme's to render, which is the entire slot-filtering guarantee.
    expect(html).not.toContain("Privacy")
  })
})

describe("every theme renders sensibly with no navigation at all", () => {
  const empty = nav({})

  it("the default theme renders with no slots populated", () => {
    const html = renderToStaticMarkup(
      <defaultTheme.Layout settings={themeDefaults(defaultTheme.settings)} brand={BRAND} nav={empty}>
        <p>body</p>
      </defaultTheme.Layout>,
    )
    // The site name still renders; no empty list is emitted.
    expect(html).toContain("FlowCMS")
    expect(html).not.toContain("<ul")
  })

  it("the integration theme renders with no slots populated", () => {
    const html = renderToStaticMarkup(
      <integrationTheme.Layout settings={themeDefaults(integrationTheme.settings)} brand={BRAND} nav={empty}>
        <p>body</p>
      </integrationTheme.Layout>,
    )
    expect(html).toContain('data-count="0"')
  })

  it("a menu with items but none active reaches the theme as an empty slot", () => {
    // `buildNavTree` filters inactive items, so "all hidden" and "no menu" are
    // the same thing by the time a theme sees it. Neither fabricates a link.
    const html = renderToStaticMarkup(
      <defaultTheme.Layout settings={themeDefaults(defaultTheme.settings)} brand={BRAND} nav={nav({ primary: [], footer: [] })}>
        <p>body</p>
      </defaultTheme.Layout>,
    )
    expect(html).not.toContain("<ul")
  })
})

describe("new-tab links are rendered safely", () => {
  it("adds rel=noopener alongside target=_blank in the default theme", () => {
    const html = renderToStaticMarkup(
      <defaultTheme.Layout settings={themeDefaults(defaultTheme.settings)}
        brand={BRAND}
        nav={nav({ primary: [{ label: "Docs", href: "https://example.com", opensInNewTab: true, children: [] }] })}
      >
        <p>body</p>
      </defaultTheme.Layout>,
    )
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener"')
  })

  it("adds rel=noopener alongside target=_blank in the integration theme", () => {
    const html = renderToStaticMarkup(
      <integrationTheme.Layout settings={themeDefaults(integrationTheme.settings)}
        brand={BRAND}
        nav={nav({ primary: [{ label: "Docs", href: "https://example.com", opensInNewTab: true, children: [] }] })}
      >
        <p>body</p>
      </integrationTheme.Layout>,
    )
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener"')
  })

  it("does not add target or rel for an ordinary link", () => {
    const html = renderToStaticMarkup(
      <integrationTheme.Layout settings={themeDefaults(integrationTheme.settings)} brand={BRAND} nav={nav({ primary: [item("Home", "/")] })}>
        <p>body</p>
      </integrationTheme.Layout>,
    )
    expect(html).not.toContain('target="_blank"')
  })
})
