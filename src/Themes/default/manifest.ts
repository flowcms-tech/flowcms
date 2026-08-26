import type { ThemeManifest } from "@/Themes/contract"

/**
 * The default theme's identity.
 *
 * `flowcmsCompat` is `^0.1.0` rather than `*`. The default theme ships inside
 * the same repository as core, so a version it cannot render is a mistake
 * somebody made in this tree — and `tests/themes/registry.test.ts` turns that
 * into a failing test instead of a broken homepage. A theme that claimed `*`
 * would be claiming to render a contract that does not exist yet.
 */
export const manifest: ThemeManifest = {
  slug: "default",
  name: "FlowCMS Default",
  version: "1.0.0",
  flowcmsCompat: "^0.1.0",
  menuSlots: ["primary", "footer"],
  description:
    "The theme FlowCMS ships with: a plain, readable shell for the blog, custom pages and the site root.",
  author: "FlowCMS",
}
