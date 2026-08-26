# flowcms

The public FlowCMS theme API. Install it to write a FlowCMS theme package.

This package is **only** the contract a theme is written against — types, a few
runtime helpers, and the settings builder. It is not the CMS. It contains no
database access, no route handlers, no admin panel, and it does not run a site.

```bash
npm install flowcms
```

```ts
import type { FlowCMSTheme, BlogPostView } from "flowcms/theme"
import { JsonLd, publicImageUrl, cn, defineThemeSettings } from "flowcms/theme"
```

## One entry point

`flowcms/theme` is the entire public surface. There is no `flowcms`,
`flowcms/views`, `flowcms/runtime`, or `flowcms/dist/...` — the package's
`exports` map deliberately makes every other path unreachable, so an internal
module cannot become somebody's dependency by accident.

What it exports:

| | |
|---|---|
| **View models** | `HomeView`, `PageView`, `BlogIndexView`, `BlogPostView`, `ArchiveView`, `AuthorArchiveView`, `NotFoundView`, and the types they are built from |
| **Surfaces** | `FlowCMSTheme`, `ThemeManifest`, `ThemeSurface`, `LayoutProps`, `THEME_SURFACES` |
| **Settings** | `defineThemeSettings`, `themeSettingsOf`, and their field types |
| **Runtime** | `JsonLd`, `publicImageUrl`, `publicImagePath`, `howToStepAnchor`, `readingTimeMinutes`, `cn`, `FLOWCMS_VERSION` |

## What a theme owns

Presentation: layout, markup, components, styles, visual hierarchy.

It does **not** own data, SEO, or routing. Core resolves everything — queries,
metadata, JSON-LD, redirects, preview authorisation, 404 logging, RSS, sitemaps,
`robots.txt` — and hands the theme a fully-resolved, typed view model. The theme
renders it.

In particular a theme never authors structured data. `view.jsonLd` arrives
already built; the theme decides only whether and where to render it. A theme
that could invent its own graph could publish false claims about the site
owner's business, which is why that boundary is not negotiable.

## A minimal theme

```tsx
import { defineThemeSettings, type FlowCMSTheme } from "flowcms/theme"

const settings = defineThemeSettings([
  { name: "accent", type: "color", label: "Accent colour", default: "#2563eb" },
])

const theme: FlowCMSTheme = {
  manifest: {
    slug: "my-theme",
    name: "My Theme",
    version: "1.0.0",
    flowcms: "^0.1.0",
    menus: ["primary", "footer"],
  },
  settings,
  Layout: ({ children }) => <div className="site">{children}</div>,
  surfaces: {
    home: ({ view }) => <h1>{view.brand.name}</h1>,
  },
}

export default theme
```

Surfaces you do not implement fall back to the default theme, so a theme can be
partial and still render a whole site.

## Compatibility

`manifest.flowcms` is a semver range checked against `FLOWCMS_VERSION` when the
theme is registered. Declare the range you have actually tested against — a
theme claiming compatibility it does not have fails at render time, on a
visitor's request, rather than at install time.

## Installing a theme into a site

Three explicit, reviewable edits in the FlowCMS project: add the dependency,
register the theme with a static import in `src/Themes/packages.ts`, and add a
Tailwind `@source` line in `src/app/globals.css` pointing at the package's
`dist`. There is no upload, no ZIP, and no runtime directory scan — Next's
tracer decides what reaches a standalone build, so a theme discovered at runtime
would simply be absent from the production image.

The Tailwind step is the one whose failure is silent: without it the markup
renders and the utility classes are missing from the stylesheet.

See `docs/distribution/packages.md` in the FlowCMS repository for the full
procedure, and `@example/flowcms-theme-aurora` for a worked example.

## Security

A theme is application code, not a passive template. It executes with the
privileges of the FlowCMS server: it can read the filesystem, open sockets, and
reach anything it can import. **There is no sandbox, and FlowCMS does not claim
one.** Install themes from sources you trust, exactly as you would any other npm
dependency.

## Requirements

Node 22 or newer, and React 19 as a peer dependency.
