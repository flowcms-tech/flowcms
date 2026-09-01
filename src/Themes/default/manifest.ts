import type { ThemeManifest } from "@/Themes/contract"

/**
 * The default theme's identity.
 *
 * `flowcmsCompat` is `^0.2.0` rather than `*`. The default theme ships inside
 * the same repository as core, so a version it cannot render is a mistake
 * somebody made in this tree — and `tests/themes/registry.test.ts` turns that
 * into a failing test instead of a broken homepage. A theme that claimed `*`
 * would be claiming to render a contract that does not exist yet.
 *
 * THIS MOVES WITH EVERY MINOR RELEASE, and it is not optional. FlowCMS is 0.x,
 * where `^0.1.0` excludes 0.2.0, so a bump that leaves this behind makes the
 * registry refuse the one theme that is the fallback for every surface — the
 * public site stops rendering entirely. It is caught at import rather than at
 * runtime, which is why a release notices it in the suite instead of on a
 * homepage.
 */
export const manifest: ThemeManifest = {
  slug: "default",
  name: "FlowCMS Default",
  version: "1.0.0",
  flowcmsCompat: "^0.2.0",
  menuSlots: ["primary", "footer"],
  description:
    "The theme FlowCMS ships with: a plain, readable shell for the blog, custom pages and the site root.",
  author: "FlowCMS",
}
