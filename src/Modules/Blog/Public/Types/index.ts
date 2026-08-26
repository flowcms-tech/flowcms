/**
 * The public blog record shapes.
 *
 * DEFINED IN `@/Themes/contract/views` since Phase 7.2, and re-exported here so
 * the queries, view models and route handlers that have always imported from
 * this path are unchanged.
 *
 * The arrow points that way because these types are the theme-facing contract
 * first and an internal convenience second. A published `flowcms/theme` has to
 * contain its own type declarations; having the package re-export from
 * `@/Modules/**` would put an unresolvable specifier in every consumer's
 * `.d.ts`.
 */
export type {
  PublicPost,
  PublicPostFaq,
  PublicPostSummary,
  PublicSeriesPost,
  PublicSeriesRef,
  PublicTaxonomy,
} from "@/Themes/contract/views"
