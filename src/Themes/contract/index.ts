/**
 * The public FlowCMS theme API.
 *
 * THIS IS THE ONLY MODULE A THEME MAY IMPORT FROM. Published, it is
 * `flowcms/theme`; inside this repository it is also reachable as
 * `@/Themes/contract`, which is what core's own surfaces use.
 *
 * A theme — built-in or third-party — imports types and helpers from here and
 * from nothing else in FlowCMS. It must never reach into `@/Modules/**`,
 * `@/db/**` or `@/Framework/**`; `tests/architecture/themeBoundaries.test.ts`
 * enforces that rather than trusting this comment.
 *
 * SINCE PHASE 7.2 THIS DIRECTORY IS ALSO THE PACKAGE SOURCE. Everything under
 * `src/Themes/contract/**` is compiled by `scripts/build-package.mjs` into
 * `packages/flowcms/dist`, which is what a theme author installs. That is why
 * the directory imports nothing but `react`, `clsx` and `tailwind-merge`:
 * whatever it reaches for, a theme author has to install too. Core-only
 * validators (`validateManifest`, `isCompatible`, `validateSettingsDefinition`
 * …) live in `src/Themes/validation/` for the same reason — Phase 6.7 stopped
 * exporting them to theme authors, and 7.2 stopped shipping them.
 *
 * WHAT A THEME IS
 *
 * A theme owns presentation: layout, markup, components, styles, visual
 * hierarchy. It does not own data, SEO or routing. Core resolves everything —
 * queries, metadata, JSON-LD, redirects, preview authorisation, 404 logging,
 * RSS, sitemaps, robots — and hands the theme a fully-resolved, typed view
 * model. The theme renders it.
 *
 * In particular a theme NEVER authors structured data. `view.jsonLd` arrives
 * already built by core; the theme decides only whether and where to render it.
 * A theme that could invent its own graph could publish false claims about the
 * site owner's business, which is why that boundary is not negotiable.
 *
 * SECURITY
 *
 * A theme is application code, not a passive template. It executes with the
 * privileges of the FlowCMS server: it can read the filesystem, open sockets,
 * and reach anything it can import. There is no sandbox, and FlowCMS does not
 * claim one. Install themes from sources you trust, exactly as you would any
 * npm dependency.
 */

export type {
  // The theme object and its manifest
  FlowCMSTheme,
  ThemeManifest,
  ThemeSurface,

  // Surface props
  LayoutProps,
  HomeView,
  PageView,
  BlogIndexView,
  BlogPostView,
  ArchiveView,
  AuthorArchiveView,
  NotFoundView,

  // Shared presentation data
  BrandView,
  NavView,
  NavItem,
  ThemeSurfaceProps,
  TocView,
  TocHeading,
  HowToData,
  HowToStepData,
  ReviewData,
  VideoData,

  // Domain records a theme renders
  PublicPost,
  PublicPostSummary,
  PublicPostFaq,
  PublicPostQuestion,
  PublicSeriesPost,
  PublicSeriesRef,
  PublicTaxonomy,
  PublicAuthor,
  PublicCustomPage,
} from "./views"

export { THEME_SURFACES } from "./views"

export { defineThemeSettings, themeSettingsOf } from "./settings"
export type {
  ThemeSettingsDefinition,
  ThemeSettingField,
  ThemeSettingFieldType,
  ThemeSettingValue,
  ThemeSettingsValues,
  ThemeSettingsOf,
  SelectOption,
  TextField,
  BooleanField,
  NumberField,
  SelectField,
  ColorField,
} from "./settings"

export {
  FLOWCMS_VERSION,
  JsonLd,
  publicImageUrl,
  publicImagePath,
  howToStepAnchor,
  readingTimeMinutes,
  cn,
} from "./runtime"

/*
 * DELIBERATELY NOT EXPORTED
 *
 * Audited in Phase 6.7, before the contract became a public API:
 *
 *   validateManifest, validateTheme, themeManifestSchema, ThemeValidation,
 *   ThemeCheck   — registry-time validators. Core runs them ON a theme; a theme
 *                  never runs them itself, and exporting them invited a theme
 *                  to self-validate and disagree with the registry.
 *   validateSettingsDefinition, isSafeColor
 *                — the same, for settings. Core validates definitions at
 *                  registry construction and values on every read and write.
 *   isCompatible, parseSemver, Semver
 *                — compatibility is core's decision about a theme, not a
 *                  theme's about itself.
 *
 * All of them still exist and are still imported by core and by tests, from
 * `src/Themes/validation/`. Phase 7.2 moved them there so they are not merely
 * unexported but absent from the published tarball.
 *
 * Audited out in Phase 7.2, when the package became real:
 *
 *   AskQuestionForm
 *                — a `'use client'` feature, not a helper: five shared admin
 *                  inputs, a Radix provider, react-hook-form, Zod, a CAPTCHA
 *                  and a POST to a FlowCMS route. Packaging it meant shipping a
 *                  copy of the admin component library inside `flowcms/theme`
 *                  and rendering a second instance of it beside the app's own.
 *                  Core now renders it and hands the theme the node, as
 *                  `BlogPostView.askQuestion`. Nothing a theme could do before
 *                  is lost; the placement decision is still the theme's.
 *
 * Adding an export later is additive; removing one after themes ship is not,
 * which is why both trims happened before publication rather than after.
 */
