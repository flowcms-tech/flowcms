/**
 * View models: everything a public surface needs, fully resolved.
 *
 * DEFINED IN `@/Themes/contract/views` since Phase 7.2. They were always the
 * theme-facing contract — the contract module re-exported them — and a
 * published package cannot re-export across the application, so the definition
 * moved and this file became the re-export.
 *
 * The boundary they encode is unchanged: **core resolves, the theme renders.**
 * Every derived value a surface could need is computed by the builders in
 * `./index.ts` — table of contents, primary category, parsed schema payloads,
 * the reader-question form — so a theme never has to reach into
 * `src/Modules/**` for a helper.
 */
export type {
  ArchiveView,
  AuthorArchiveView,
  BlogIndexView,
  BlogPostView,
  HowToData,
  HowToStepData,
  ReviewData,
  TocView,
  VideoData,
} from "@/Themes/contract/views"
