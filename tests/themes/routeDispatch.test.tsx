import { describe, expect, it } from "vitest"
import { NO_SETTINGS } from "./settingsFixtures"

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import type { ComponentProps, ComponentType, ReactElement } from "react"
import { selectSurface } from "@/Themes/resolver"
import { defaultTheme } from "@/Themes/default"
import { THEME_SURFACES, type FlowCMSTheme, type ThemeSurface } from "@/Themes/contract"
import {
  ARCHIVE_VIEW,
  AUTHOR_ARCHIVE_VIEW,
  BLOG_INDEX_VIEW,
  BLOG_POST_VIEW,
  BRAND,
  HOME_VIEW,
  NOT_FOUND_VIEW,
  PAGE_VIEW,
} from "../fixtures/viewFixtures"

/**
 * Route → surface dispatch.
 *
 * The failure this file exists to catch is the quiet one: a route wired to the
 * wrong surface. `/blog/tag/[slug]` asking for `CategoryArchive` renders
 * perfectly today, because both are the same component in the default theme —
 * and breaks the moment somebody ships a theme where they differ, which is the
 * whole point of them being separate surfaces. Nothing about the rendered page
 * would tell you.
 *
 * So the mapping is asserted directly against the route source. That is a file
 * check rather than a render check on purpose: rendering a Next.js page module
 * means a request, a database and a `params` promise, and none of those would
 * make the assertion stronger. What is rendered — that each surface produces
 * its own markup from its own view model — is checked separately below, through
 * a fixture theme whose surfaces are individually identifiable.
 */

const APP = join(process.cwd(), "src", "app")

/** Route file → the surface it must resolve. */
const DISPATCH: Array<[route: string, surface: ThemeSurface]> = [
  ["page.tsx", "Home"],
  ["[...path]/page.tsx", "Page"],
  ["blog/page.tsx", "BlogIndex"],
  ["blog/[slug]/page.tsx", "BlogPost"],
  ["blog/category/[slug]/page.tsx", "CategoryArchive"],
  ["blog/tag/[slug]/page.tsx", "TagArchive"],
  ["blog/author/[slug]/page.tsx", "AuthorArchive"],
  ["not-found.tsx", "NotFound"],
]

function routeSource(route: string): string {
  const path = join(APP, route)
  if (!existsSync(path)) throw new Error(`route file is missing: src/app/${route}`)
  return readFileSync(path, "utf8")
}

function walk(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...walk(full))
    else if (/\.tsx?$/.test(full)) found.push(full)
  }
  return found
}

describe("every public HTML route resolves exactly one surface, and the right one", () => {
  it.each(DISPATCH)("src/app/%s resolves %s", (route, surface) => {
    const source = routeSource(route)
    const resolved = [...source.matchAll(/resolveSurface\(\s*["'](\w+)["']\s*\)/g)].map((m) => m[1])
    expect(resolved).toEqual([surface])
  })

  it("covers every surface the contract defines", () => {
    // If a surface is added to the contract and no route renders it, this fails
    // rather than the surface quietly never appearing on a website.
    expect([...DISPATCH.map(([, surface]) => surface)].sort()).toEqual([...THEME_SURFACES].sort())
  })
})

describe("routes do not name a theme", () => {
  it("no public HTML route imports the default theme directly", () => {
    // The point of the resolver. A route that imports `@/Themes/default` has
    // hardcoded the answer 6.3 is going to change.
    const offenders: string[] = []
    for (const [route] of DISPATCH) {
      const source = routeSource(route)
      if (/@\/Themes\/default/.test(source)) offenders.push(`src/app/${route}`)
      if (/"default"/.test(source)) offenders.push(`src/app/${route} (literal slug)`)
    }
    expect(offenders).toEqual([])
  })

  it("nothing under src/app imports a theme except through the resolver or the contract", () => {
    const offenders: string[] = []
    for (const file of walk(APP)) {
      const source = readFileSync(file, "utf8")
      for (const match of source.matchAll(/from\s+["'](@\/Themes[^"']*)["']/g)) {
        const specifier = match[1]
        if (specifier === "@/Themes/resolver") continue
        if (specifier.startsWith("@/Themes/contract")) continue
        // Dependency-free shared constants — see themeBoundaries.test.ts.
        if (specifier === "@/Themes/constants") continue
        offenders.push(`${relative(process.cwd(), file).split("\\").join("/")} → ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe("metadata, feed and API routes stay core-owned", () => {
  // Themes own HTML presentation. They do not own protocol output: an RSS feed,
  // a sitemap and robots.txt are contracts with software, not with a reader,
  // and a theme that could rewrite them could deindex a site by accident.
  const CORE_ONLY = [
    "blog/rss.xml/route.ts",
    "blog/news-sitemap.xml/route.ts",
    "robots.ts",
    "sitemap.ts",
    "sitemap-index.xml/route.ts",
  ]

  it.each(CORE_ONLY)("src/app/%s does not use the ThemeResolver", (route) => {
    const source = routeSource(route)
    expect(source).not.toMatch(/resolveSurface|resolveLayout|resolveTheme|ThemeShell/)
  })

  it("no API route uses the ThemeResolver", () => {
    const offenders = walk(join(APP, "api"))
      .filter((file) => /resolveSurface|resolveLayout|resolveTheme|ThemeShell/.test(readFileSync(file, "utf8")))
      .map((file) => relative(process.cwd(), file).split("\\").join("/"))
    expect(offenders).toEqual([])
  })

  it("no admin route is wrapped in the public theme shell", () => {
    // The admin panel has its own layout and its own colour scheme. Wrapping it
    // in the public shell would give an operator a public site header above
    // their dashboard and pin their panel to the public palette.
    const offenders = walk(join(APP, "admin-panel"))
      .filter((file) => /ThemeShell|@\/Themes\/(default|resolver)/.test(readFileSync(file, "utf8")))
      .map((file) => relative(process.cwd(), file).split("\\").join("/"))
    expect(offenders).toEqual([])
  })
})

describe("the theme shell wraps every themed surface exactly once", () => {
  /** Routes that render inside the shell — every surface except NotFound. */
  const SHELLED = DISPATCH.filter(([, surface]) => surface !== "NotFound")

  it.each(SHELLED)("src/app/%s renders %s inside one ThemeShell", (route) => {
    const source = routeSource(route)
    const opens = source.match(/<ThemeShell>/g) ?? []
    const closes = source.match(/<\/ThemeShell>/g) ?? []
    // Exactly one, not "at least one": a nested shell would apply
    // `.public-surface` twice and redefine the same tokens inside themselves.
    expect(opens).toHaveLength(1)
    expect(closes).toHaveLength(1)
  })

  it("the 404 route deliberately renders outside the shell", () => {
    // The one exception, pinned so it stays a decision rather than an
    // oversight. The default theme's NotFound is a full-bleed page — its own
    // background, its own centring — so a header above it and a footer below
    // would be a visual redesign, and 6.2 is a dispatch refactor. The 404 is
    // also the surface that must work when something else has already failed,
    // and the shell reads Settings.
    const source = routeSource("not-found.tsx")
    expect(source).not.toContain("<ThemeShell>")
    expect(source).toContain("NotFoundReporter")
  })

  it("only ThemeShell renders a theme Layout", () => {
    // A route composing the Layout itself would bypass the `.public-surface`
    // boundary and the brand/nav resolution that go with it.
    const sources = [...walk(APP), ...walk(join(process.cwd(), "src", "Modules"))]
    const offenders = sources
      .filter((file) => /resolveLayout/.test(readFileSync(file, "utf8")))
      .map((file) => relative(process.cwd(), file).split("\\").join("/"))
    expect(offenders).toEqual(["src/Modules/Public/Components/ThemeShell.tsx"])
  })
})

describe("each surface renders its own view model", () => {
  /**
   * A theme whose every surface is individually identifiable.
   *
   * The default theme cannot prove dispatch on its own: `CategoryArchive` and
   * `TagArchive` are literally the same component, so rendering one and finding
   * the other's markup proves nothing. These stubs make every surface distinct.
   */
  const marker = (surface: ThemeSurface) =>
    function Marker() {
      return <div data-surface={surface}>{`[${surface}]`}</div>
    }

  const markerTheme: FlowCMSTheme = {
    manifest: defaultTheme.manifest,
    Layout: defaultTheme.Layout,
    ...Object.fromEntries(THEME_SURFACES.map((surface) => [surface, marker(surface)])),
  }

  /**
   * Each entry is type-checked against the props of the surface it belongs to,
   * so a fixture that drifted from the contract fails here rather than
   * rendering something the application never produces.
   */
  // `settings` is supplied once below rather than repeated in every entry:
  // these fixtures exist to pin the VIEW MODELS, and a settings object on each
  // line would be noise that hid the thing being checked.
  type SurfaceViews = {
    [K in ThemeSurface]: Omit<ComponentProps<NonNullable<FlowCMSTheme[K]>>, "settings">
  }

  const VIEWS: SurfaceViews = {
    Home: HOME_VIEW,
    Page: PAGE_VIEW,
    BlogIndex: BLOG_INDEX_VIEW,
    BlogPost: BLOG_POST_VIEW,
    CategoryArchive: ARCHIVE_VIEW,
    TagArchive: { ...ARCHIVE_VIEW, kind: "tag" },
    AuthorArchive: AUTHOR_ARCHIVE_VIEW,
    NotFound: NOT_FOUND_VIEW,
  }

  /**
   * Surface `name`, as an element, paired with its own view model.
   *
   * The only cast in this file, in one place, and it is over a limitation
   * rather than over data. Iterating `THEME_SURFACES` makes the component a
   * union of component types and `VIEWS[name]` a union of prop types;
   * TypeScript cannot see that the two unions are correlated, so it rejects the
   * spread even though every pairing is correct. The shapes themselves are
   * checked by `SurfaceViews` above and by `viewFixtures.ts`, neither of which
   * casts anything — so what is bridged here is the correlation, not the data.
   */
  function element(theme: FlowCMSTheme, name: ThemeSurface): ReactElement {
    const Surface = selectSurface(theme, defaultTheme, name) as unknown as ComponentType<
      Record<string, unknown>
    >
    return <Surface settings={NO_SETTINGS} {...(VIEWS[name] as unknown as Record<string, unknown>)} />
  }

  function render(theme: FlowCMSTheme, name: ThemeSurface): string {
    return renderToStaticMarkup(element(theme, name))
  }

  it.each(THEME_SURFACES)("resolving %s yields that surface and no other", (surface) => {
    const html = render(markerTheme, surface)

    expect(html).toContain(`[${surface}]`)
    for (const other of THEME_SURFACES) {
      if (other === surface) continue
      expect(html).not.toContain(`[${other}]`)
    }
  })

  it("renders each real default-theme surface from its own view model", () => {
    // The same walk against the shipped theme, so the fixtures above are known
    // to drive real markup and not just stubs.
    const expected: Array<[ThemeSurface, string]> = [
      ["Home", "This site has no front page yet"],
      ["Page", "About Us"],
      ["BlogIndex", "A Post About Everything"],
      ["BlogPost", "Step by step"],
      ["CategoryArchive", "Category"],
      ["TagArchive", "Tag"],
      ["AuthorArchive", "Ada Lovelace"],
      ["NotFound", "Page not found"],
    ]

    for (const [surface, expectedText] of expected) {
      expect(render(defaultTheme, surface), surface).toContain(expectedText)
    }
  })

  it("wraps every surface in the resolved Layout exactly once", () => {
    // `<main>` is the invariant, not `<header>` or `<footer>`. Those are
    // sectioning content and legitimately repeat — BlogIndex has its own
    // `<header>` for the page title, BlogPost a `<footer>` for its tags — so
    // counting them would fail on correct markup. `<main>` may appear once per
    // document, only the Layout renders one, and a doubled shell is precisely
    // what would produce two.
    const Layout = defaultTheme.Layout

    for (const surface of THEME_SURFACES) {
      const html = renderToStaticMarkup(
        <Layout settings={NO_SETTINGS} brand={BRAND} nav={{ slots: {} }}>
          {element(defaultTheme, surface)}
        </Layout>,
      )
      expect(html.match(/<main[\s>]/g) ?? [], surface).toHaveLength(1)
    }
  })

  it("no surface renders its own <main>, which is the Layout's to own", () => {
    for (const surface of THEME_SURFACES) {
      expect(render(defaultTheme, surface).match(/<main[\s>]/g) ?? [], surface).toHaveLength(0)
    }
  })
})
