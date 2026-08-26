# @example/flowcms-theme-aurora

A **package-shaped FlowCMS theme**. It exists so the public theme contract is
proved by something that lives outside the application tree, is built and packed
like any npm package, and imports FlowCMS only through `flowcms/theme`.

It is not a product theme. It reaches an operator only when
`FLOWCMS_INTEGRATION_THEMES=1` is set, and it is registered by an explicit
static import in `src/Themes/packages.ts` exactly as a real theme would be.

## Installing a theme like this

Three explicit, reviewable edits in the FlowCMS project. No upload, no ZIP, no
runtime scan.

**1. Add the dependency**

```bash
npm install @example/flowcms-theme-aurora
```

**2. Register it** in `src/Themes/packages.ts`

```ts
import auroraTheme from "@example/flowcms-theme-aurora"

export function packageThemes(): ThemeEntry[] {
  return [["aurora", auroraTheme]]   // the key MUST equal manifest.slug
}
```

**3. Register it with Tailwind** in `src/app/globals.css`

```css
@source "../../node_modules/@example/flowcms-theme-aurora/dist";
```

Then rebuild. **Step 3 is about a failure that is silent when it happens.** Your
utility classes exist in the final stylesheet only if the application's Tailwind
build read this package; if it did not, the markup renders, the layout
collapses, and nothing in the build says why. FlowCMS's current Tailwind finds
an installed package on its own, so the line is redundant today — it is written
anyway, because that is undocumented behaviour that has changed between Tailwind
releases and a theme author cannot fix a host they do not control.

Installing needs a build. **Activating does not** — an administrator switches
the active theme in Appearance at runtime.

You do **not** need a tsconfig `paths` entry, and you should not add one. An
alias resolves the theme's source directly and hides every packaging mistake it
exists to catch.

## What it deliberately proves

| | |
|---|---|
| **Package boundary** | Imports `flowcms/theme` and `react`. Nothing else — asserted against the BUILT output, not the source. |
| **Real resolution** | `flowcms/theme` resolves through `node_modules`. There is no repository alias for it any more. |
| **Partial theme** | Implements `Layout`, `Home` and `BlogIndex`. **Omits `BlogPost`**, so surface fallback stays part of the proof. |
| **Menu slots** | Declares `primary` and `sidebar`. `sidebar` is a slot no built-in theme declares. |
| **Settings** | A boolean, a select and a text field, all visibly rendered, all per-key typed. |
| **Compatibility** | `flowcmsCompat: "^0.1.0"`, evaluated against the runtime `FLOWCMS_VERSION`. |
| **Tailwind through a package** | Uses `tracking-[0.4375em]`, an arbitrary-value utility that appears nowhere else in FlowCMS. If it is in the production stylesheet, Tailwind read this package. |
| **Package assets** | Ships `screenshot.png` and exposes it as a subpath, so the application can import it into Next's asset pipeline. |

## Three versions, three jobs

Theme authors conflate these constantly, so this package keeps them visibly
different:

| Number | Where | Means |
|---|---|---|
| `1.2.0` | `package.json#version` | the package release |
| `^0.1.0` | `manifest.flowcmsCompat` | which FlowCMS versions it renders against |
| `2` | `settings.version` | the shape of its persisted settings |

## Building it

```bash
npm run build:example-theme     # from the FlowCMS repository root
```

`tsc` with this package's own `tsconfig.json` — no repository aliases, no `@/*`,
`flowcms/theme` resolved from `node_modules`. That is the point: a shortcut here
would make the whole fixture circular.

See `docs/distribution/packages.md` for the package model and
`docs/themes/authoring.md` for the contract itself.
