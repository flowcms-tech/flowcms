import type { ThemeEntry } from "./registry"
// flowcms:template-strip:start — the example theme is a repository fixture
import auroraTheme from "@example/flowcms-theme-aurora"
import auroraScreenshot from "@example/flowcms-theme-aurora/screenshot.png"
// flowcms:template-strip:end

/**
 * PACKAGE THEMES: themes that arrive as a dependency rather than as a directory
 * in this project.
 *
 * This file is what "installing a theme" looks like, and it is deliberately
 * unglamorous — an import and an entry, reviewed like any other change:
 *
 *     import someTheme from "@scope/flowcms-theme-something"
 *     ...
 *     return [["something", someTheme]]
 *
 * Installing a theme is three edits: add the dependency, add the import and
 * entry here, and add a Tailwind `@source` line for the package's `dist` in
 * `src/app/globals.css`. Then rebuild. ACTIVATING a theme that is already
 * installed needs none of that — it is a runtime setting in Appearance.
 *
 * WHY A STATIC IMPORT AND NOT A SCAN. Next's tracer decides what reaches the
 * standalone output by following static imports. A theme discovered by reading
 * `node_modules` at runtime is a theme the tracer never saw, so it is simply
 * absent from the production image and the failure surfaces as a 500 on a
 * customer's homepage. Phases 4 and 5 each lost a day to that exact class of
 * bug with database drivers and migration SQL. A scan would also let anything
 * dropped into a directory execute with server privileges.
 *
 * The registry key MUST equal the theme's `manifest.slug`; `buildRegistry`
 * refuses the build if they disagree, because activating it by name would
 * otherwise resolve to nothing.
 */
// flowcms:template-strip:start
/**
 * WHAT THE ENTRY BELOW IS — in this repository only.
 *
 * `@example/flowcms-theme-aurora` is a FIXTURE. It exists to prove the public
 * contract works for an out-of-tree package, and listing it in the Appearance
 * screen of every FlowCMS install would be product clutter. It shares the
 * `FLOWCMS_INTEGRATION_THEMES` seam with the built-in integration theme rather
 * than adding a second knob: one documented variable, two fixtures proving two
 * different boundaries.
 *
 * The gate is about REGISTRY INCLUSION, not module resolution. The import above
 * is unconditional and always resolves; what the variable decides is whether
 * the theme is offered to an operator. A real package theme has no gate.
 *
 * THE SCREENSHOT IS AN IMPORT for a related reason. A theme inside
 * `node_modules` is not served by Next, and a page-relative path would resolve
 * under whatever the admin path happens to be. Importing the file puts it
 * through the asset pipeline: Next emits it, traces it into the standalone
 * build, and hands back a URL the Appearance card can use. The APPLICATION does
 * that, not the theme — asset handling is the host's job, and a theme that had
 * to import from `next/*` would stop being portable.
 *
 * Everything between the strip markers in this file — the imports above, the
 * branch below, and the helper at the bottom — is removed by
 * `scripts/build-create-flowcms.mjs`, so a generated project starts with no
 * package themes at all.
 */
// flowcms:template-strip:end
export function packageThemes(): ThemeEntry[] {
  // flowcms:template-strip:start
  if (process.env.FLOWCMS_INTEGRATION_THEMES === "1") {
    return [["aurora", withScreenshot(auroraTheme)]]
  }
  // flowcms:template-strip:end

  return []
}

// flowcms:template-strip:start
/**
 * The theme as it was authored, plus the screenshot URL only the application
 * can know.
 *
 * A copy rather than a mutation: the theme object is the package's own export
 * and other importers (the tests, for one) must see it exactly as its author
 * wrote it.
 */
function withScreenshot(theme: typeof auroraTheme): typeof auroraTheme {
  return {
    ...theme,
    manifest: { ...theme.manifest, screenshot: auroraScreenshot.src },
  }
}

export { auroraTheme }
// flowcms:template-strip:end
