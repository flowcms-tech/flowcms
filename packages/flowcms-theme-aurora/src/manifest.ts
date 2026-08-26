import type { ThemeManifest } from "flowcms/theme"

/**
 * Aurora's identity.
 *
 * `slug` is the ACTIVATION identifier — what `settings.activeTheme` stores and
 * what an operator activates. It is deliberately not the npm package name:
 * `@example/flowcms-theme-aurora` is how the package is distributed, `aurora`
 * is what FlowCMS calls it. The registry key must equal this slug, and the
 * registry refuses the build if they disagree.
 *
 * `flowcmsCompat` is a range over the FlowCMS version, not over this package's
 * version. It is what makes a theme that stops working after an upgrade show up
 * as *unavailable* in Appearance instead of crashing a site.
 */
export const manifest: ThemeManifest = {
  slug: "aurora",
  name: "Aurora",
  version: "1.2.0",
  flowcmsCompat: "^0.1.0",
  // `sidebar` is declared by no built-in theme, so slot handling is provably
  // driven by the manifest rather than by a list hardcoded in core.
  menuSlots: ["primary", "sidebar"],
  description: "A package-shaped example theme that proves the public FlowCMS theme contract.",
  author: "Example Themes",
  authorUrl: "https://example.test/themes/aurora",
}
