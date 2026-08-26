# Writing a FlowCMS theme

A theme owns how a FlowCMS site **looks**. Core owns everything else — the data,
the metadata, the structured data, the routing, the storage. You are handed
fully-resolved, typed view models and you return JSX.

Every code sample below is taken from a theme that is compiled and tested in
this repository: `packages/flowcms-theme-aurora`. If a name here is wrong, that
package stops compiling and `tests/themes/publicContract.test.ts` fails.

> **`flowcms` is not on npm yet.** The package exists — it is built from
> `src/Themes/contract` into `packages/flowcms` — so `npm install flowcms` does
> not resolve and npm cannot auto-install it as a peer. Until it is published,
> develop your theme against a FlowCMS checkout or a locally packed tarball,
> exactly as section 16 describes. `@example/flowcms-theme-aurora` is not
> published either; it is a fixture in this repository and the samples use it as
> a stand-in for your own package name.

---

## 1. What a theme is (and is not)

| A theme owns | Core owns |
|---|---|
| Layout, markup, components, styling | Queries, view models, pagination |
| Which surfaces it implements | Metadata, canonical URLs, OpenGraph |
| Its own declarative settings | **All JSON-LD construction** |
| Rendering the navigation it is given | Menus, redirects, preview, RSS, sitemap, robots, 404 logging |

A theme is **not a plugin**. FlowCMS has no plugin system and none is planned
for v0.1. Themes do not add routes, endpoints, database tables, admin screens or
background work.

## 2. The trusted-code model — read this before shipping anything

**A FlowCMS theme is server-side application code.** It is compiled into the
application and runs with the application's privileges: it can read the
filesystem, open sockets, and reach anything it can import.

**FlowCMS does not sandbox theme code, and does not claim to.**

Manifest and settings validation exist to protect *product invariants* and
*operator data* — a malformed manifest fails the build predictably instead of
breaking a settings screen later, and an operator's colour value cannot become a
CSS payload. **None of that is protection against a malicious theme.** Install
themes the way you would install any npm dependency that runs on your server:
from sources you trust, having read what you are installing.

## 3. Installation vs activation vs configuration

Three different operations. Conflating them is the most common misunderstanding.

| | What it is | Needs |
|---|---|---|
| **Installation** | Adding or removing theme *code* from the FlowCMS build | The package, an explicit registry import, **a rebuild and redeploy** |
| **Activation** | Choosing which already-built theme renders the site | One database write. **No rebuild, no restart** |
| **Configuration** | Editing that theme's settings or its menus | Database writes only |

FlowCMS never loads theme code at runtime. There is no upload, no ZIP install,
no directory scan, and no `import(variable)` — Next's tracer decides what
reaches the production image by following *static* imports, so a theme it never
saw is simply absent from the artifact.

## 4. Package structure

```
my-theme/
  package.json
  src/
    index.ts        # the FlowCMSTheme object (default export)
    manifest.ts     # identity, compatibility, menu slots
    settings.ts     # optional declarative settings
    Layout.tsx      # required
    BlogIndex.tsx   # optional surfaces…
```

`package.json`:

```json
{
  "name": "@example/flowcms-theme-aurora",
  "version": "1.2.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "peerDependencies": {
    "flowcms": ">=0.1.0 <0.2.0",
    "react": "^19.0.0"
  },
  "flowcms": { "type": "theme", "slug": "aurora", "entry": "./src/index.ts" },
  "keywords": ["flowcms", "flowcms-theme"]
}
```

- **React and `flowcms` are peers, never dependencies.** A theme renders inside
  the host application's React; bundling a second copy gives you two renderers
  and a hooks error nobody can explain. While `flowcms` is unpublished, npm
  cannot resolve that peer from the registry — see the note at the top of this
  guide, and section 16 for how to develop against a checkout instead.
- The `flowcms` block is **discovery metadata for tooling and humans**. The
  runtime never reads it — reading `package.json` at runtime would be a
  filesystem scan by another name. The TypeScript manifest is authoritative.
- Naming is a **recommendation**, not a rule: `flowcms-theme-*` or
  `@scope/flowcms-theme-*`. The package name and the theme slug are unrelated;
  only the slug identifies the theme to FlowCMS.

## 5. What you may import

Exactly one FlowCMS module:

```ts
import { ... } from "flowcms/theme"
```

Plus `react`. Nothing else. `tests/architecture/packageBoundary.test.ts` fails
the build if a theme reaches for `@/db`, `@/Framework`, `@/Modules`, `@/app`, a
relative path outside its own directory, or any SEO builder.

If you need something the contract does not export, that is a gap to raise —
not something to work around.

### The public surface

| | |
|---|---|
| **Theme shape** | `FlowCMSTheme`, `ThemeManifest`, `ThemeSurface`, `THEME_SURFACES` |
| **Surface props** | `LayoutProps`, `ThemeSurfaceProps`, and one view type per surface: `HomeView`, `PageView`, `BlogIndexView`, `BlogPostView`, `ArchiveView`, `AuthorArchiveView`, `NotFoundView` |
| **Shared data** | `BrandView`, `NavView`, `NavItem`, `TocView`, `TocHeading`, `HowToData`, `HowToStepData`, `ReviewData`, `VideoData` |
| **Domain records** | `PublicPost`, `PublicPostSummary`, `PublicPostFaq`, `PublicPostQuestion`, `PublicSeriesPost`, `PublicSeriesRef`, `PublicTaxonomy`, `PublicAuthor`, `PublicCustomPage` |
| **Settings** | `defineThemeSettings`, `themeSettingsOf`, and the field types |
| **Components** | `JsonLd` |
| **Helpers** | `publicImageUrl`, `publicImagePath`, `howToStepAnchor`, `readingTimeMinutes`, `cn`, `FLOWCMS_VERSION` |

`JsonLd` is a **security boundary**, not a convenience: it escapes its payload
against script-tag break-out. Hand-rolling it means inheriting an escaping bug
on every page that renders a graph.

### The reader-question form is a slot, not an import

`AskQuestionForm` was on this list until v0.1's packaging work and is not any
more. It is a `'use client'` feature — five shared admin inputs, a Radix
provider, react-hook-form, Zod, a CAPTCHA and a POST to a FlowCMS route — so
publishing it inside `flowcms/theme` meant shipping a copy of the FlowCMS admin
component library to every theme author and rendering a second instance of it
beside the application's own.

Core renders the form and hands it to you as **`BlogPostView.askQuestion`**:

```tsx
export default function BlogPost({ post, askQuestion }: BlogPostView) {
  return (
    <article>
      {/* … */}
      <div className="mt-12">{askQuestion}</div>
    </article>
  )
}
```

You keep the only decision you wanted — whether to show it, and where — and the
CAPTCHA and rate limiting stay somewhere a theme cannot weaken them.

## 6. The manifest

```ts
import type { ThemeManifest } from "flowcms/theme"

export const manifest: ThemeManifest = {
  slug: "aurora",
  name: "Aurora",
  version: "1.2.0",
  flowcmsCompat: "^0.1.0",
  menuSlots: ["primary", "sidebar"],
  description: "A package-shaped example theme.",
  author: "Example Themes",
  authorUrl: "https://example.test/themes/aurora",
}
```

- `slug` is the **activation identifier** — lowercase letters, digits, hyphens.
  It must equal the registry key, or the build fails.
- `screenshot` is optional and must be a **path inside your own package**. Remote
  URLs, `data:`, absolute paths and anything containing `..` are rejected — a
  theme must not be able to phone home from every operator's admin panel.

### Three version numbers, three jobs

Authors conflate these constantly:

| Number | Where | Means |
|---|---|---|
| `1.2.0` | `package.json#version` | your package release |
| `^0.1.0` | `manifest.flowcmsCompat` | which FlowCMS versions you render against |
| `2` | `settings.version` | the shape of your persisted settings |

`flowcmsCompat` is evaluated against the runtime `FLOWCMS_VERSION` constant. If
it does not match, your theme is recorded **installed but unavailable**: the
site keeps running on the default theme, the admin explains why, and nothing
crashes. That is deliberate — an operator upgrading FlowCMS must not lose their
admin panel because of a theme.

## 7. The required Layout

```tsx
import { themeSettingsOf, type LayoutProps, type NavItem } from "flowcms/theme"
import { auroraSettings } from "./settings"

export default function Layout({ brand, nav, settings, children }: LayoutProps) {
  const s = themeSettingsOf(auroraSettings, settings)

  return (
    <div data-theme="aurora">
      <header>
        {s.showAurora ? <p>{s.bannerText}</p> : null}
        <h1>{brand.siteName}</h1>
        <nav aria-label="Primary">
          <NavList items={nav.slots.primary ?? []} />
        </nav>
      </header>
      <main>{children}</main>
    </div>
  )
}
```

`Layout` is the only required surface — a theme without one has nothing to
render into, so the registry refuses it rather than falling back.

Note what a surface never does: **no queries, no `await`, no globals.** Brand,
navigation and settings all arrive as props already resolved. That is what keeps
a theme an ordinary package.

## 8. Optional surfaces and fallback

Implement as few or as many as you like:

`Home`, `Page`, `BlogIndex`, `BlogPost`, `CategoryArchive`, `TagArchive`,
`AuthorArchive`, `NotFound`.

Anything you omit falls back to the default theme's implementation. **Most real
themes are partial** — Aurora implements `Layout`, `Home` and `BlogIndex` only.

### The subtle rule: settings follow the *implementation*

With Aurora selected and `BlogPost` omitted:

| URL | Renders | With which settings |
|---|---|---|
| `/blog` | **Aurora** `BlogIndex` inside **Aurora** `Layout` | Aurora's |
| `/blog/a-post` | **Default** `BlogPost` inside **Aurora** `Layout` | **Default's** for the post, Aurora's for the Layout |

A default-theme component is never handed Aurora's settings keys — it never
declared them. Settings belong to the theme whose component actually renders.

### Whole-theme fallback

If the selected theme is **missing, incompatible or invalid**, FlowCMS renders
the default theme everywhere, with the default theme's settings, and logs one
warning. **The stored selection is left untouched** until an operator changes
it: FlowCMS does not auto-heal your database. Reinstall the theme and it renders
again, with its settings and menus intact.

## 9. View models are the public data API

A surface receives `ThemeSurfaceProps<SomeView>` — the view model plus
`settings`:

```tsx
import { JsonLd, type BlogIndexView, type ThemeSurfaceProps } from "flowcms/theme"

export default function BlogIndex({ posts, page, totalPages, jsonLd }: ThemeSurfaceProps<BlogIndexView>) {
  return (
    <section>
      <JsonLd data={jsonLd} />
      <ul>
        {posts.map((post) => (
          <li key={post.id}><a href={`/blog/${post.slug}`}>{post.title}</a></li>
        ))}
      </ul>
      <p>Page {page} of {totalPages}</p>
    </section>
  )
}
```

These are **not database rows**. They are resolved, filtered, ordered
presentation data, and they are the stable surface — treat them as the API.

## 10. SEO belongs to core, permanently

`view.jsonLd` arrives **already built by core**. You decide whether and where to
render it, through `<JsonLd data={…} />`. You never construct a graph.

A theme that could author structured data could publish claims about the
operator's business that the operator never made, and nobody reviews a theme's
JSON-LD. The same applies to metadata, canonical URLs, RSS, sitemaps and
`robots.txt`: all core-owned, none reachable from the contract.

## 11. Menus

Declare slots in your manifest; core hands you `NavView` for **those slots
only**:

```tsx
function NavList({ items }: { items: NavItem[] }) {
  if (items.length === 0) return null
  return (
    <ul>
      {items.map((item) => (
        <li key={`${item.href}-${item.label}`}>
          <a href={item.href} {...(item.opensInNewTab ? { target: "_blank", rel: "noopener" } : {})}>
            {item.label}
          </a>
          <NavList items={item.children} />
        </li>
      ))}
    </ul>
  )
}
```

- One menu per location in v0.1; trees are **two levels deep**.
- `href` is already resolved and validated. Entity-backed items point at current
  URLs; broken or unpublished targets are omitted before you see them.
- **Never query menu tables.** Menus belong to slot *names*, not to themes, so
  switching themes never deletes menu data — a menu for a slot your theme does
  not declare simply is not passed to you, and returns when a theme declaring it
  is active again.
- Always render sensibly with **zero items**. That is the fresh-install state.

## 12. Theme settings

Declarative metadata — never admin React. Core renders the form.

```ts
import { defineThemeSettings, type ThemeSettingsOf } from "flowcms/theme"

export const auroraSettings = defineThemeSettings({
  version: 2,
  fields: [
    { key: "showAurora", type: "boolean", label: "Show the banner", default: true },
    {
      key: "headingStyle", type: "select", label: "Heading style", default: "plain",
      options: [{ value: "plain", label: "Plain" }, { value: "loud", label: "Loud" }],
    },
    { key: "bannerText", type: "text", label: "Banner text", default: "Aurora", maxLength: 60 },
  ],
})

export type AuroraSettings = ThemeSettingsOf<typeof auroraSettings>
```

Read them with `themeSettingsOf(auroraSettings, settings)`, which narrows the
open settings object to your own keys and types — `s.showAurora` is a `boolean`,
not `unknown`, with no cast in your code.

### Field types (v0.1)

`text`, `textarea`, `boolean`, `number`, `select`, `color` — and nothing else.
No repeaters, no groups, no arbitrary HTML.

- Keys are **camelCase**, ≤48 characters, ≤40 fields. `__proto__`,
  `constructor` and `prototype` are refused.
- Every field needs a `default`, and the default must satisfy its own field.
- `select` persists option **values**, never labels.
- `color` accepts `#RGB`, `#RRGGBB`, `#RRGGBBAA` — no named colours, no `rgb()`,
  no `var()`, nothing that could carry a second CSS declaration.
- Text fields may declare a stricter `maxLength`; the core ceiling is 4000
  characters and a whole settings row is capped at 16 KB.

### What happens to stored values

- **Write path strict**: unknown keys, wrong types, out-of-range numbers,
  undeclared select values and bad colours are refused.
- **Read path resilient**: an invalid stored value falls back to your declared
  default and the admin is told; corrupt JSON yields all defaults plus a
  warning; **nothing is ever rewritten on a render**.
- Bump `version` when your fields change in a way that matters to stored rows.
  Old rows are kept, resolved as far as your current definition allows, and the
  admin shows the mismatch. Keys your current version no longer declares are
  **preserved in the row** but never handed to you.
- **Reset deletes the row.** "No overrides" is the absence of a row, so a later
  change to your defaults still reaches operators who once pressed Reset.
- Values are **operator input**, not your code. Render them as text children and
  let React escape them. Never `dangerouslySetInnerHTML` a setting.

## 13. Assets

| Kind | Where it lives | How to use it |
|---|---|---|
| **Theme-owned** — icons, decorations, screenshot | Inside your package, bundled at build | Import it, or reference a package-relative path |
| **CMS media** — anything an operator uploaded | S3-compatible storage, core-managed | `publicImageUrl` / `publicImagePath` |

Never handle storage keys yourself. View models already contain resolved URLs;
the helpers exist for the cases that do not.

## 14. Styling

- Tailwind utilities work. Class names must be **statically analysable** —
  Tailwind scans source text, so `max-w-6xl` works and `` `max-w-${size}` ``
  silently produces nothing. Map a setting to a **closed set** of classes:
  ```ts
  const WIDTH = { narrow: "max-w-3xl", normal: "max-w-6xl", wide: "max-w-7xl" }
  ```
  This also keeps operator input out of your class list.
- `.public-surface` is **core's**, applied once by `ThemeShell` outside your
  Layout. It pins the public site to its own colour tokens so a visitor is not
  affected by the admin's theme cookie. Do not declare it; redefine tokens
  *inside* your own markup instead.
- There is no runtime CSS loading. Anything you need must be part of the build.
- **If your theme is an installed package, tell the site to scan it.** Your
  utility classes only exist in the final stylesheet if the application's
  Tailwind build read your package. On the versions FlowCMS ships today it does
  so automatically, but that is undocumented behaviour that has changed between
  Tailwind releases — and when it changes, your markup renders and your styling
  silently does not. One line in `src/app/globals.css` makes it explicit:
  ```css
  @source "../../node_modules/@your-scope/flowcms-theme-yours/dist";
  ```
  Point it at your BUILT output, which is what ships in the tarball. Say so in
  your README; it is the single most likely thing to go wrong for someone
  installing your theme.
- **Utility classes are the whole styling mechanism in v0.1.** A theme package
  shipping its own `.css` file is not supported.

## 15. Installing your theme into a site

Three explicit, reviewable edits. No upload, no ZIP, no runtime scan.

**1. Add the dependency**

```bash
npm install @example/flowcms-theme-aurora
```

(Substitute your own package name. Neither this fixture nor `flowcms` itself is
published yet, so today that install comes from a path or a packed tarball —
section 16.)

**2. Register it** in `src/Themes/packages.ts`

```ts
import auroraTheme from "@example/flowcms-theme-aurora"

export function packageThemes(): ThemeEntry[] {
  return [["aurora", auroraTheme]]   // key MUST equal manifest.slug
}
```

**3. Register it with Tailwind** in `src/app/globals.css`

```css
@source "../../node_modules/@example/flowcms-theme-aurora/dist";
```

Then rebuild and redeploy. The default theme is mandatory and always present —
it is the fallback for everything.

**Installing needs a build; activating does not.** An administrator switches the
active theme in Appearance at runtime. There is no installed-themes table: what
is installed is a property of the artifact.

A future FlowCMS installer will automate exactly these three edits. It will not
gain a new mechanism, because there is not one.

## 16. Developing and testing locally

1. `npm install` your theme into a FlowCMS checkout — from a path
   (`npm install ../my-theme`) or from a tarball you built with `npm pack`.
   **Do not add a tsconfig `paths` entry.** An alias resolves your source
   directly and hides every packaging mistake you are trying to find: a wrong
   `exports` map, a missing `files` entry, an unbuilt `dist`. It works for you
   and fails for everyone who installs your theme.
2. Do the three edits in section 15.
3. `npm run dev`, then activate it in **Appearance → Themes**.
4. `npm test` — the registry validates every theme at construction, so a broken
   manifest or settings definition fails there rather than in a browser.
5. Before you release, `npm pack` your theme and install THAT into a scratch
   project. It is the only check that sees what a stranger gets.

Copy `packages/flowcms-theme-aurora` as a starting point. It is deliberately
small, it is built and packed exactly like a third-party theme, and every rule
in this guide is enforced against it.

## 17. Common mistakes

| Mistake | What happens |
|---|---|
| Registry key ≠ `manifest.slug` | Build fails. Activation would resolve to nothing. |
| Importing `@/…` | Boundary test fails; your package could not resolve it once published anyway. |
| Building your own JSON-LD | Boundary test fails. SEO is core's. |
| Interpolating a setting into a Tailwind class | Tailwind emits nothing; the class silently does not exist. |
| Assuming a menu slot has items | Fresh installs have none. Render for zero. |
| `dangerouslySetInnerHTML` on a setting | An operator's text becomes markup. |
| Depending on `react` instead of peering it | Two React copies, hooks errors. |
| Bumping `package.json#version` for a settings change | Wrong number. Bump `settings.version`. |

## 18. Compatibility policy (pre-v1)

FlowCMS is **0.x**. The theme contract may still evolve.

- `flowcmsCompat` is **mandatory**. Pin a range you have actually tested.
- Breaking changes to the public theme contract come with a FlowCMS version
  change and a note here.
- `tests/themes/publicContract.test.ts` pins the export surface, so an
  accidental removal is caught in this repository rather than in yours.
- This is not yet a mature plugin-ecosystem guarantee, and it is better to say
  so than to imply one.

## 19. What v0.1 does not include

No marketplace. No ZIP upload or install-from-URL. No automatic npm
installation. No runtime theme loading. No preview-before-activation. No child
themes. No widgets. No page builder. No plugin system. No theme-supplied admin
React.

These are absent by design, not by oversight. Themes are trusted code compiled
into the build.
