# FlowCMS packages

What FlowCMS publishes, what is public, and what a theme package may rely on.

> **Nothing here is published yet** (see
> [Project status](../../README.md#project-status)). `flowcms` is built and
> packed locally, and `npm publish` is blocked on purpose — see
> [Release blockers](#release-blockers). Do not write instructions that tell
> people to `npm install flowcms` until that changes.

## The model: one package, one public subpath

| | What it is | Published? |
|---|---|---|
| `flowcms-app` (repository root) | the FlowCMS **application** — the CMS itself, and the template `create-flowcms` will later emit | never. `"private": true` |
| `flowcms` (`packages/flowcms`) | the public **theme API**, built from `src/Themes/contract` | eventually. Blocked today |
| `@example/flowcms-theme-aurora` | an example theme, used to prove the boundary | never. It is a fixture |
| `create-flowcms` (`packages/create-flowcms`) | the scaffolder that generates a site — see [create-flowcms.md](./create-flowcms.md) | eventually. Blocked today |

There is one published package and it exposes one subpath:

```ts
import { defineThemeSettings, type FlowCMSTheme } from "flowcms/theme"
```

**Why one package.** There is exactly one public consumer today — someone
writing a theme — and one public surface. Splitting `@flowcms/core` from
`@flowcms/theme` would be fragmentation with no technical problem to solve, and
`flowcms/theme` is already the specifier Phase 6 documented and Aurora compiles
against.

**Why the application is a separate name.** npm refuses to install a package
under a package of the same name, so a repository root called `flowcms` could
never resolve `flowcms/theme` for a theme living inside it. The root is
`flowcms-app`: private, never published, and not a library.

**There is no root export.** `import "flowcms"` fails, by design. FlowCMS is an
application, not a library you instantiate, and a root export would imply
otherwise — and would be the first place someone asked for an internal.

## Where the package comes from

`src/Themes/contract/**` **is** the package source. `scripts/build-package.mjs`
compiles that directory with `tsconfig.package.json` and emits
`packages/flowcms/dist`.

```
src/Themes/contract/
  index.ts              the public entry — what `flowcms/theme` is
  views.ts              every view model and record type a theme renders
  settings.ts           the settings vocabulary and the two authoring helpers
  version.ts            FLOWCMS_VERSION
  runtime/              JsonLd, publicImageUrl, readingTime, howToStepAnchor, cn
```

That directory is a **leaf**: it imports `react`, `clsx`, `tailwind-merge` and
its own files, and nothing else. This is what makes the package possible at all,
and it is enforced three times over — by `tsconfig.package.json` having no
`paths` at all, by an audit inside the build, and by
`tests/packaging/packageArtifact.test.ts`.

Core's own opinions about themes — `validateManifest`, `isCompatible`,
`validateSettingsDefinition`, `isSafeColor` — live in `src/Themes/validation/`.
Phase 6.7 stopped exporting them to theme authors; Phase 7.2 stopped shipping
them.

The application keeps importing `@/Themes/contract` internally. It is the same
source, and a test asserts the packaged export set and the internal one are
identical, so they cannot drift.

### Build output

`tsc` and nothing else. There is no bundler because there is no graph to bundle.

- **ESM only.** `"type": "module"`, no dual CJS build. Nothing in the consumer
  story needs `require`, and dual packaging is a reliable source of
  duplicate-instance bugs.
- **`.js` extensions are added to emitted relative specifiers** after
  compilation. `moduleResolution: "bundler"` emits `./views`, which Node's ESM
  resolver rejects — and a package that only works inside a bundler cannot be
  smoke tested. The repository's own sources stay extensionless.
- **No source maps and no declaration maps.** A declaration map points at `.ts`
  files that are not in the tarball, so every consumer "go to definition" would
  404; shipping the sources to fix that would publish the application's layout.
- **Comments are kept** in the emitted declarations. They are the only
  documentation that travels with the types.

### Supported toolchain

| | Value | Why |
|---|---|---|
| Node | `>=22` | what the production image runs and what is tested. Claiming lower would be claiming something untested |
| TypeScript | 5.9+ | the version this repository compiles the declarations with |
| `moduleResolution` | `bundler`, `node16` or `nodenext` | what a Next.js app and a modern theme package use |
| React | `^19` — a **peer** | a theme renders inside the host's React. A second copy is two renderers and a hooks error nobody can explain |
| Next.js | not a dependency at all | nothing in `flowcms/theme` needs it. A theme that imported `next/*` would stop being an ordinary React package |
| Bun | supported for developing FlowCMS, not required by the package | no Bun-specific exports exist and none should be added |

## The public API

Everything below is exported from `flowcms/theme`. Nothing else is.

**Runtime values**

| Export | What it is |
|---|---|
| `JsonLd` | renders a core-built graph into a `<script type="application/ld+json">`, escaped |
| `publicImageUrl` / `publicImagePath` | build the URL for a stored image — absolute and origin-relative |
| `howToStepAnchor` | the anchor id core's `HowToStep.url` points at |
| `readingTimeMinutes` | reading time from a stored word count |
| `cn` | Tailwind-aware class merge |
| `defineThemeSettings` / `themeSettingsOf` | declare settings, and read them with their own types |
| `THEME_SURFACES` | the surface names core dispatches to |
| `FLOWCMS_VERSION` | the running version, which `flowcmsCompat` is evaluated against |

**Types**: `FlowCMSTheme`, `ThemeManifest`, `ThemeSurface`; the surface props
(`LayoutProps`, `HomeView`, `PageView`, `BlogIndexView`, `BlogPostView`,
`ArchiveView`, `AuthorArchiveView`, `NotFoundView`); shared presentation data
(`BrandView`, `NavView`, `NavItem`, `ThemeSurfaceProps`, `TocView`,
`TocHeading`, `HowToData`, `HowToStepData`, `ReviewData`, `VideoData`); and the
records a theme renders (`PublicPost`, `PublicPostSummary`, `PublicPostFaq`,
`PublicPostQuestion`, `PublicSeriesPost`, `PublicSeriesRef`, `PublicTaxonomy`,
`PublicAuthor`, `PublicCustomPage`) plus the settings vocabulary.

### What is deliberately not public

Registry-time validators, the resolver, the registry itself, Settings services,
Appearance, admin components, route handlers, the database layer and the
migration tools. None of it is exported and none of it is in the tarball.

`AskQuestionForm` was public in Phase 6 and is not any more. It is a
`'use client'` feature built from five shared admin inputs, a Radix provider,
react-hook-form, Zod and a CAPTCHA, posting to a FlowCMS route — packaging it
meant shipping a copy of the admin component library inside `flowcms/theme` and
rendering a second instance of it beside the application's own. Core now renders
the form and hands the theme the node as **`BlogPostView.askQuestion`**:

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

Nothing a theme could do is lost — the placement decision, which is the only
part a theme wanted, is still the theme's — and the CAPTCHA and the rate-limited
submit path stay inside core where a theme cannot weaken them.

### Deep imports are blocked

Only `flowcms/theme` resolves. `flowcms`, `flowcms/dist/index.js`,
`flowcms/views`, `flowcms/runtime` and `flowcms/src/Themes/contract` all fail,
because the package's `exports` map lists one public subpath and `exports`
closes everything it does not name. There is no top-level `main`, `module` or
`types` field, since any of those would re-open directory resolution.

Import `flowcms/theme` and nothing else. Do not document, and do not rely on,
any other specifier.

## Installing a package theme

Three explicit, reviewable edits. No runtime discovery, no upload, no scan.

**1. Add the dependency**

```bash
npm install @example/flowcms-theme-aurora
```

**2. Register it** in `src/Themes/packages.ts`

```ts
import auroraTheme from "@example/flowcms-theme-aurora"

export function packageThemes(): ThemeEntry[] {
  return [["aurora", auroraTheme]]   // key MUST equal manifest.slug
}
```

**3. Tell Tailwind about it** in `src/app/globals.css`

```css
@source "../../node_modules/@example/flowcms-theme-aurora/dist";
```

Then rebuild. **Installation needs a build; activation does not** — an
administrator switches the active theme in Appearance at runtime, and the choice
lives in `settings.activeTheme`. There is no `installed_themes` table: what is
installed is a property of the artifact, and a database row cannot make code
exist.

### Step 3, and what was actually measured

A theme package ships markup full of utility classes, and something has to make
sure the application's Tailwind build reads them. If nothing does, the theme's
markup renders and every one of its classes is purged: the page loads, the
layout collapses, and nothing in the build says why.

The measurement, on Tailwind 4.3.3 under Next 16.2.6, with the theme present
**only** as an installed package — a real directory under `node_modules`, its
source moved out of the project tree entirely — and grepping the production
stylesheet for Aurora's `tracking-[0.4375em]`, which appears nowhere else in
FlowCMS:

| | Result |
|---|---|
| with the `@source` line | present |
| without it | **also present** |

So Tailwind's automatic source detection currently reaches into `node_modules`
on its own, and step 3 is redundant with this version. It is still documented
and still written, for a reason that is not superstition: that behaviour is an
implementation detail of a Tailwind version FlowCMS does not control, it has
changed across releases, and what it silently underwrites is a **supported
extension point**. Leaning on undocumented automatic behaviour is how a silent
purge ships in a later upgrade, against themes nobody in this repository can
test.

The path points at the package's **built output**, which is what ships in the
tarball. Pointing at `src` works in this repository and silently stops working
for anyone who installed the package.

> An earlier draft of this document asserted the opposite — that `@source` was
> required and that Turbopack ignored it. Both claims came from grepping the
> production CSS for `0.4375em` when the minifier had written `.4375em`. The
> table above is what the corrected measurement says.

### CSS: utilities only, in v0.1

A theme package styles itself with **Tailwind utility classes in its markup**.
That is the whole supported mechanism for v0.1.

There is no runtime CSS injection and none is planned. A theme shipping its own
`.css` file is not supported: importing CSS from a dependency inside an App
Router server component is not something FlowCMS is prepared to promise across
Next versions, and half-promising it is worse than saying no.

### Assets

A theme package may ship files — a screenshot, an image — inside its `files`
allowlist, and expose them through its own `exports` map:

```json
"exports": { "./screenshot.png": "./screenshot.png" },
"files": ["dist", "screenshot.png", "README.md"]
```

The application reaches them with a **static import**, beside the registry
entry:

```ts
import auroraScreenshot from "@example/flowcms-theme-aurora/screenshot.png"
// …
manifest: { ...auroraTheme.manifest, screenshot: auroraScreenshot.src }
```

Next emits the file to `/_next/static/media/…`, traces it into the standalone
build, and hands back a URL. A path *inside* `node_modules` is not served by
Next and a page-relative path resolves under whatever the admin path happens to
be, so the import is not a convenience — it is the only thing that works.

The application does the importing, not the theme. Asset handling is the host's
job, and a theme that had to import from `next/*` would stop being portable.

`ThemeManifest.screenshot` accepts a same-origin URL: root-relative or
page-relative. Anything with a scheme, protocol-relative, containing `..`, or
containing a backslash is refused and the card falls back to a placeholder — a
manifest is theme-author input, and an `<img src>` pointing off-origin would let
a theme phone home from every operator's admin panel on every page view.

## Versioning

`packages/flowcms/package.json`'s `version` and `FLOWCMS_VERSION` must be the
same string. They mean different things — one is what npm resolves, the other is
what a theme's `flowcmsCompat` range is evaluated against — but they describe
the same release, and an artifact published under a number that disagrees with
the one it reports at runtime tells theme authors the wrong thing.

The build fails if they disagree, and a test asserts it independently.

`FLOWCMS_VERSION` stays hand-maintained in `src/Themes/contract/version.ts`
rather than read from `package.json` at runtime. Next's tracer decides what
reaches a standalone build, and a JSON file nothing imports statically is
exactly what it leaves behind — a version check that throws `ENOENT` in
production and works in development is worse than no check.

A theme carries three numbers and they are not interchangeable:

| Number | Meaning |
|---|---|
| `package.json#version` | the theme package release |
| `manifest.flowcmsCompat` | which FlowCMS versions it renders against |
| `settings.version` | the shape of its persisted settings |

Two more numbers exist outside this package: the application's own `version`,
which must equal `FLOWCMS_VERSION` for the same reason the package's does, and
`create-flowcms`'s, which is **independent on purpose** — a CLI fix must be
publishable without claiming FlowCMS changed. What ties a generated project to a
FlowCMS release is `template.json`'s `templateVersion`, written out of
`FLOWCMS_VERSION` by the template build.

All five, in full:

| # | Number | Where | Maintained | Rule |
|---|---|---|---|---|
| 1 | `FLOWCMS_VERSION` | `src/Themes/contract/version.ts` | by hand | The source of truth. A hardcoded literal, deliberately not read from `package.json` at runtime — Next's tracer omits a JSON file nothing imports statically, and a compat check that throws `ENOENT` only in production is worse than none. |
| 2 | `flowcms` `version` | `packages/flowcms/package.json` | by hand | **Must equal #1.** One is what npm resolves, the other is what a theme's `flowcmsCompat` is evaluated against. |
| 3 | application `version` | root `package.json` | by hand | **Must equal #1.** The application *is* FlowCMS. |
| 4 | `templateVersion` | `packages/create-flowcms/template.json` | generated | Written from #1 by `scripts/build-create-flowcms.mjs`. Build output, gitignored. |
| 5 | `create-flowcms` `version` | `packages/create-flowcms/package.json` | by hand | **Independent on purpose.** A CLI fix must be publishable without claiming FlowCMS changed. What ties a generated project to a FlowCMS release is #4, not this. |

A theme package carries three more that are also not interchangeable:
`package.json#version` (the theme release), `manifest.flowcmsCompat` (which
FlowCMS versions it renders against) and `settings.version` (the shape of its
persisted settings). Aurora's are `1.2.0`, `^0.1.0` and `2`.

What enforces each: `scripts/build-package.mjs` refuses to build on a #1/#2
mismatch, `tests/packaging/packageArtifact.test.ts` checks the built export
against its manifest, and `tests/packaging/versionAlignment.test.ts` checks
#1↔#2, #1↔#3, #1↔#4 and Aurora's two ranges from manifests and source alone —
so it runs without a build.

## Verifying the boundary

```bash
npm run build:packages            # build flowcms and the example theme
npm test                          # builds, then runs the suite including tests/packaging
node scripts/verify-package-consumer.mjs   # the full proof
```

`verify-package-consumer.mjs` packs both packages, installs the **tarballs**
into a throwaway directory outside this repository, and from there typechecks
with `strict` and `skipLibCheck: false`, compiles a file that must *not* compile,
executes every runtime export, renders a theme surface to static markup, and
confirms every deep import fails. React and TypeScript are packed out of this
repository's `node_modules`, so the proof needs no registry and no network.

The repository resolves `flowcms` and the example theme through `file:` links.
That is right for developing them and worthless as evidence — a link exposes the
whole source directory, so every `files` mistake and every missing export works
anyway. Only the tarball has the shape a stranger gets.

## Package managers

npm is the canonical packaging test: the artifact is built, packed and installed
with npm, and that is what the proofs above run.

The package metadata uses nothing npm-specific — `exports`, `files`, `engines`,
`peerDependencies` and `sideEffects` are all standard, and there is no
`packageManager` field, no install lifecycle script and no `.npmrc` — so pnpm,
yarn and bun should resolve it identically. **They have not been tested**, and
this document will not claim they work until they have been. The future
`npx create-flowcms` UX targets all four, which is when that testing belongs.

## Release blockers

Nothing has been published yet. `flowcms` and `create-flowcms` are publishable
when the release workflow is deliberately dispatched, and their `prepublishOnly`
guards validate the licence, the repository metadata and the built artifacts
before npm sends anything — refusing outright unless a real release is in
progress, so a hand-run `npm publish` fails. `npm pack` is unaffected, so every
proof above still runs. `@example/flowcms-theme-aurora` carries a guard of a
different kind, alongside `"private": true`: the other two say *not yet*,
Aurora's says *never* — it is an integration fixture and is not a package this
project would publish under any circumstances.

Still open before `flowcms` can be published:

1. **`create-flowcms` must not go to npm before `flowcms` does.** A generated
   project carries a local copy of `flowcms` by decision (see
   [`create-flowcms.md`](./create-flowcms.md)), but the scaffolder ships
   documentation pointing theme authors at a package that would not yet exist.
2. **The npm names.** Neither `flowcms` nor `create-flowcms` has been claimed on
   the registry. `create-flowcms` is a requirement rather than a preference:
   `npm create flowcms` resolves that literal name and no other. If `flowcms`
   turns out to need a scope, `flowcms/theme` becomes `@scope/flowcms/theme`
   everywhere — a rename with a blast radius, and cheapest to discover before
   publication.
3. **Release execution.** The publish guards are armed on purpose and are lifted
   deliberately, in the commit that cuts the release.

## What future CI must run

These are the package-boundary gates. They are not wired to CI in this phase;
they are the list CI must implement when it exists.

| Gate | Command |
|---|---|
| Package build, including the artifact audit | `npm run build:packages` |
| Tarball contents | `npm pack --dry-run` on both packages |
| Clean-consumer install, typecheck and runtime smoke | `node scripts/verify-package-consumer.mjs` |
| Unit suite, including `tests/packaging` | `npm test` |
| Production build with the package theme registered | `FLOWCMS_INTEGRATION_THEMES=1 npm run build` |
| Standalone tracing of the installed theme | assert `.next/standalone/node_modules/@example/flowcms-theme-aurora` exists |
| Tailwind proof | grep the built CSS for `letter-spacing:.4375em` — the minifier drops the leading zero, and grepping for `0.4375em` reports a false negative |
| Docker image build and render | `docker build` plus a request that renders the active theme |
