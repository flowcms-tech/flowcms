import type { ComponentType, ReactNode } from "react"
import type { ThemeSettingsDefinition, ThemeSettingsValues } from "./settings"

/**
 * The data contracts a theme renders from.
 *
 * THIS MODULE DEFINES THEM. It used to be a facade that re-exported types from
 * `@/Modules/**`, which read as the same boundary and was not one: two of those
 * re-exports were *derived* from application internals —
 *
 *     type PublicCustomPage = NonNullable<Awaited<ReturnType<typeof getPublishedPageByPath>>>
 *     type HowToData        = ReturnType<typeof howToDataFor>
 *
 * — so their declarations reached into Drizzle, Zod and `server-only`. That is
 * invisible while `flowcms/theme` is a path alias inside this repository and
 * fatal the moment it is a published package: a theme author's typecheck would
 * need FlowCMS's database layer installed to learn what a page is.
 *
 * Phase 7.2 inverted the arrow. The contract declares the shapes; the
 * application conforms to them, and the query and validation layers carry
 * compile-time assertions that they still do. The former homes re-export from
 * here, so nothing in the app changed except which file is authoritative.
 *
 * THE FILE IS A LEAF, and it has to stay one: it imports `react` and nothing
 * else, because whatever it imports a theme author must install.
 *
 * WHAT A THEME IS. A theme owns presentation. It does not own data, SEO or
 * routing. Core resolves everything — queries, metadata, JSON-LD, redirects,
 * preview authorisation, 404 logging, RSS, sitemaps, robots — and hands the
 * theme a fully-resolved, typed view model. The theme renders it. In particular
 * a theme NEVER authors structured data: `view.jsonLd` arrives already built,
 * and the theme decides only whether and where to render it.
 */

// -- Domain records a theme legitimately renders ------------------------------

export interface PublicPostSummary {
  id: string
  title: string
  slug: string
  excerpt: string
  featuredImageUrl: string
  featuredImageAltText: string
  publishedAt: Date | null
  /**
   * Computed on write. Reading time is derived from it at render
   * (`readingTimeMinutes`) rather than stored, so the divisor stays tunable
   * without a migration. Null on rows written before the column existed —
   * every consumer treats that as "unknown" and renders nothing.
   */
  wordCount: number | null
  /** Alphabetical. `categories[0]` is therefore the deterministic fallback for
   *  the primary category, which is the whole point of ordering it here rather
   *  than taking whichever row the join returned first. */
  categories: { id: string; name: string; slug: string }[]
  tags: { id: string; name: string; slug: string }[]
  /**
   * The public byline. Resolves to the assigned blog author when there is one,
   * otherwise falls back to the admin account that created the post so old
   * posts never render blank. `isRealAuthor` distinguishes the two: only a
   * real author carries E-E-A-T fields worth putting in structured data.
   */
  author: {
    id: string
    name: string
    isRealAuthor: boolean
    slug: string | null
    jobTitle: string | null
    credentials: string | null
    bio: string | null
    avatarUrl: string | null
    avatarAltText: string | null
    /** schema.org Person.sameAs — profile links, blanks already removed. */
    sameAs: string[]
  }
}

export interface PublicPostFaq {
  id: string
  question: string
  answer: string
}

export interface PublicSeriesRef {
  id: string
  name: string
  slug: string
}

/** One entry in the in-post series strip. Unpublished parts are included
 *  deliberately — "Part 4 is coming" is useful, a link that 404s is not, so the
 *  renderer needs the flag rather than the query filtering them out. */
export interface PublicSeriesPost {
  id: string
  title: string
  slug: string
  seriesPosition: number | null
  isPublished: boolean
}

export interface PublicPost extends PublicPostSummary {
  content: string
  metaTitle: string | null
  metaDescription: string | null
  canonicalUrl: string | null
  ogImageUrl: string
  isIndexable: boolean
  updatedAt: Date
  /**
   * Set only when an editor ticked "substantive update". Feeds `dateModified`
   * and the visible "Last updated" line; `updatedAt` above never does, because
   * it bumps on a typo fix and re-dating unchanged content is the pattern
   * Google treats as manipulative.
   */
  contentUpdatedAt: Date | null
  isCornerstone: boolean
  seriesId: string | null
  seriesPosition: number | null
  series: PublicSeriesRef | null
  /** Null falls back to the alphabetically-first entry in `categories`. */
  primaryCategoryId: string | null
  /** schema.org type of the page's main entity. Drives which node the JSON-LD
   *  builder emits, and whether `schemaData` carries a payload at all. */
  schemaType: string
  /** Raw JSON, parsed against `schemaType` by core before the theme sees it.
   *  A theme reads `view.howTo` / `view.review` / `view.video` instead — this
   *  field is the unparsed source those are derived from. */
  schemaData: string | null
  /** CSS selectors for `speakable`. Already parsed and blank-filtered. */
  speakableSelectors: string[]
  focusKeyword: string | null
  faqs: PublicPostFaq[]
}

export interface PublicTaxonomy {
  id: string
  name: string
  slug: string
  description: string | null
  metaTitle: string | null
  metaDescription: string | null
  canonicalUrl: string | null
  /** false emits noindex on the archive. The archive stays reachable. */
  isIndexable: boolean
  /** Intro copy above the grid, page 1 only. */
  archiveIntro: string | null
  /**
   * Published **and** indexable posts in this taxonomy.
   *
   * Computed per request, never stored: an archive with zero of them is
   * noindex regardless of its own flag, and a stored count goes stale the
   * moment a post is published.
   */
  indexablePostCount: number
}

/** One published, answered reader question. Shaped like `PublicPostFaq` on
 *  purpose — the renderer and the FAQPage builder treat the two as one list, so
 *  a shape mismatch would mean a second code path for the same output. */
export interface PublicPostQuestion {
  id: string
  question: string
  answer: string
  /** Null when the reader left it blank, which is common and fine. */
  askerName: string | null
}

export interface PublicAuthor {
  id: string
  name: string
  slug: string
  jobTitle: string | null
  credentials: string | null
  bio: string | null
  avatarUrl: string | null
  avatarAltText: string | null
  /** schema.org Person.sameAs — profile links, blanks already removed. */
  sameAs: string[]
  metaTitle: string | null
  metaDescription: string | null
  canonicalUrl: string | null
  isIndexable: boolean
}

/**
 * A published custom page.
 *
 * Written out rather than inferred from the row it is built from, and the
 * difference is not cosmetic. Inferring it meant the theme-facing type carried
 * `createdById`, `createdAt`, `ogImageKey` and `isPublished` — internal columns
 * a theme has no business reading, one of which is a storage key. Declaring the
 * fields is how the boundary became a boundary; `publicPageQueries.ts` is
 * checked against this and no longer defines it.
 */
export interface PublicCustomPage {
  id: string
  title: string
  /** Absolute, with a leading slash: `/privacy-policy`. */
  path: string
  /** Raw stored body. Themes render `PageView.html`, which is the sanitised
   *  form; this is here because core's metadata builders read it. */
  content: string
  metaTitle: string | null
  metaDescription: string | null
  canonicalUrl: string | null
  /** Already resolved from the stored object key — a theme never sees a key. */
  ogImageUrl: string | null
  isIndexable: boolean
  /** Set once on first publish and kept across unpublish/republish. */
  publishedAt: Date | null
  updatedAt: Date
}

export interface TocHeading {
  id: string
  text: string
  level: number
  children: TocHeading[]
}

// -- Parsed structured-data payloads ------------------------------------------

/**
 * Already parsed and narrowed against the post's `schemaType`, so a theme never
 * touches `JSON.parse` and never decides what a payload means.
 *
 * These are declared here and the Zod schemas in
 * `Modules/Blog/Posts/Values/Validations.ts` are asserted to produce exactly
 * them. That direction matters: the validation schemas are an input contract
 * for the admin form, and letting a form schema BE the public type means every
 * validation tweak is a breaking change for themes.
 */
export interface HowToStepData {
  name: string
  text: string
  imageKey?: string
}

export type HowToData = {
  totalTime?: string
  estimatedCost?: string
  tools: string[]
  supplies: string[]
  steps: HowToStepData[]
} | null

export type ReviewData = {
  itemName: string
  itemType: string
  rating: number
  bestRating: number
  worstRating: number
  pros: string[]
  cons: string[]
} | null

export type VideoData = {
  contentUrl: string
  embedUrl?: string
  thumbnailKey?: string
  uploadDate: string
  duration?: string
} | null

// -- View models: everything a public surface needs, fully resolved -----------

/**
 * WHY THESE EXIST
 *
 * Before Phase 6.0 the presentation modules did three jobs: they rendered
 * markup, ran their own queries, and built their own JSON-LD. That was
 * tolerable while FlowCMS shipped exactly one front end. It stops being
 * tolerable the moment a theme can be swapped, because every one of those
 * responsibilities becomes the theme author's — and the third one is FlowCMS's
 * structured data.
 *
 * So the boundary is: **core resolves, the theme renders.** These types are the
 * shape of "resolved".
 */

export interface TocView {
  /**
   * The content to render — NOT `post.content`.
   *
   * `buildTableOfContents` returns HTML with anchor ids injected in the same
   * pass that built the heading tree. Rendering the raw content instead leaves
   * every table-of-contents link pointing at nothing.
   */
  html: string
  headings: TocHeading[]
  /** Whether there are enough headings to be worth showing a TOC at all. */
  hasToc: boolean
}

export interface BlogPostView {
  post: PublicPost
  /**
   * Moderated reader questions. The same array is rendered AND marked up — it
   * is fed to the FAQPage graph in `jsonLd` below, and the rule is that nothing
   * enters that graph which is not on the page.
   */
  questions: PublicPostQuestion[]
  related: PublicPostSummary[]
  seriesPosts: PublicSeriesPost[]
  toc: TocView
  primaryCategory: { id: string; name: string; slug: string } | null
  howTo: HowToData
  review: ReviewData
  video: VideoData
  /**
   * The reader-question form, already constructed by core.
   *
   * A SLOT, not a component the theme imports, and Phase 7.2 made it one
   * deliberately. It used to be `AskQuestionForm` on the public contract — a
   * `'use client'` component built from five shared admin inputs, a Radix
   * provider, react-hook-form, Zod and a CAPTCHA, posting to a FlowCMS route.
   * Publishing `flowcms/theme` meant either shipping a copy of the admin
   * component library to every theme author or admitting the export was not
   * package-safe. It was not.
   *
   * Handing over the rendered node keeps the CAPTCHA and the rate-limited
   * submit path inside core where a theme cannot weaken them, and leaves the
   * theme the decision it actually wants: whether to show it, and where.
   */
  askQuestion: ReactNode
  /** Core-built structured data. Themes render it; they never construct it. */
  jsonLd: unknown
}

export interface BlogIndexView {
  posts: PublicPostSummary[]
  page: number
  totalPages: number
  jsonLd: unknown
}

export interface ArchiveView {
  taxonomy: PublicTaxonomy
  kind: "category" | "tag"
  posts: PublicPostSummary[]
  page: number
  totalPages: number
  jsonLd: unknown
}

export interface AuthorArchiveView {
  author: PublicAuthor
  posts: PublicPostSummary[]
  page: number
  totalPages: number
  jsonLd: unknown
}

// -- Surfaces that had no view model before 6.1 ------------------------------

/** Site identity, resolved from Settings by core. */
export interface BrandView {
  siteName: string
  /** Null when unset. There is deliberately no default tagline — the previous
   *  one was a customer's marketing line and shipped on every install. */
  tagline: string | null
  /**
   * Origin-relative URL for the site logo, or null when none is configured.
   * Already resolved from the stored object key, so a theme never handles
   * storage keys and never needs credentials to render an image.
   */
  logoUrl: string | null
  logoAltText: string | null
}

/**
 * Navigation passed to the Layout.
 *
 * Populated by core from the menus configured for the slots THIS theme's
 * manifest declares — a theme is handed the slots it asked for and no others.
 *
 * A slot with no menu, a menu with no items, and a menu whose every item is
 * hidden all arrive the same way: as an absent or empty array. A theme must
 * render sensibly with no items rather than assuming at least one, which
 * `tests/themes/render.test.tsx` checks.
 */
export interface NavItem {
  label: string
  href: string
  opensInNewTab: boolean
  children: NavItem[]
}

export interface NavView {
  /** Keyed by the slot names the theme declared in its manifest. Reading a
   *  slot that was never populated yields undefined, not a throw. */
  slots: Record<string, NavItem[] | undefined>
}

/**
 * The props every theme surface receives: its view model, plus the settings of
 * the theme that OWNS the component being rendered.
 *
 * One convention for every surface, Layout included. The settings are resolved
 * by core and passed in — a theme never queries, never awaits, and never reads
 * a global. During a surface-level fallback the component belongs to the
 * default theme, so it receives the DEFAULT theme's settings rather than the
 * selected theme's; mixing the two namespaces would hand a component keys it
 * never declared.
 */
export type ThemeSurfaceProps<V, S extends ThemeSettingsValues = ThemeSettingsValues> = V & {
  settings: S
}

export interface LayoutProps<S extends ThemeSettingsValues = ThemeSettingsValues> {
  brand: BrandView
  nav: NavView
  /** Resolved settings for the theme whose Layout this is. */
  settings: S
  children: ReactNode
}

export interface HomeView {
  brand: BrandView
  /**
   * Core-built LocalBusiness JSON-LD, or null when no business profile is
   * configured. The theme renders it; it never authors it.
   */
  jsonLd: unknown
}

export interface PageView {
  page: PublicCustomPage
  /**
   * Core-built WebPage JSON-LD. This used to be assembled inside the page
   * component — exactly the arrangement the contract exists to prevent, since
   * a theme that can author structured data can publish claims about the
   * operator's site that the operator never made.
   */
  jsonLd: unknown
  /** The page body, already sanitised by core. Render it with
   *  `dangerouslySetInnerHTML`; do not re-clean or re-parse it. */
  html: string
}

export interface NotFoundView {
  brand: BrandView
}

// -- The theme itself --------------------------------------------------------

export interface ThemeManifest {
  /** URL-safe identifier, unique across installed themes. */
  slug: string
  name: string
  /** The theme's own version, `x.y.z`. */
  version: string
  /** Which FlowCMS versions this theme supports, e.g. `^0.1.0`. */
  flowcmsCompat: string
  /**
   * Navigation slots this theme renders, e.g. `["primary", "footer"]`.
   * An administrator assigns one menu per slot in Appearance → Menus, and core
   * passes `NavView` for these slots only.
   */
  menuSlots: string[]
  description?: string
  author?: string
  authorUrl?: string
  /**
   * A URL the FlowCMS application can serve for this theme's preview image,
   * shown on the Appearance screen. Same-origin only: either root-relative
   * (`/_next/static/media/aurora.9f3b.png`) or relative to the admin page.
   *
   * A PACKAGE theme cannot know this value, because it is produced by the
   * application's bundler. The supported route is a static import beside the
   * registry entry — Next emits the file, traces it into the standalone build
   * and hands back a URL:
   *
   *     import screenshot from "@example/flowcms-theme-aurora/screenshot.png"
   *     ...
   *     { ...auroraTheme, manifest: { ...auroraTheme.manifest, screenshot: screenshot.src } }
   *
   * Remote URLs are refused rather than rendered: a manifest is theme-author
   * input, and an `<img src>` pointing off-origin would let a theme phone home
   * from every operator's admin panel on every page view. See
   * `safeScreenshotPath`.
   */
  screenshot?: string
}

/**
 * A FlowCMS theme.
 *
 * `manifest` and `Layout` are required — a theme with neither identity nor a
 * shell is not a theme. Every content surface is optional, and core falls back
 * to the default theme for anything a theme does not implement, so a theme that
 * only restyles the blog is legitimate and small.
 *
 * SECURITY: a theme is application code, not a passive template. It runs with
 * the privileges of the FlowCMS server. There is no sandbox and none is
 * claimed. Install themes you trust, exactly as you would an npm dependency.
 */
export interface FlowCMSTheme {
  manifest: ThemeManifest
  /**
   * Declarative settings this theme exposes to an operator, or omitted.
   *
   * Metadata, never React: core owns the admin form. The DEFINITION is trusted
   * theme source code; the VALUES are operator input and are validated on the
   * way in and again on the way out. Validated at registry construction, so a
   * malformed definition makes the theme unavailable rather than breaking the
   * settings screen later.
   */
  settings?: ThemeSettingsDefinition
  Layout: ComponentType<LayoutProps>
  Home?: ComponentType<ThemeSurfaceProps<HomeView>>
  Page?: ComponentType<ThemeSurfaceProps<PageView>>
  BlogIndex?: ComponentType<ThemeSurfaceProps<BlogIndexView>>
  BlogPost?: ComponentType<ThemeSurfaceProps<BlogPostView>>
  /** Categories and tags share a view; they differ only by label and path. */
  CategoryArchive?: ComponentType<ThemeSurfaceProps<ArchiveView>>
  TagArchive?: ComponentType<ThemeSurfaceProps<ArchiveView>>
  AuthorArchive?: ComponentType<ThemeSurfaceProps<AuthorArchiveView>>
  NotFound?: ComponentType<ThemeSurfaceProps<NotFoundView>>
}

/** Surface names core can dispatch to, for registry and fallback logic. */
export const THEME_SURFACES = [
  "Home",
  "Page",
  "BlogIndex",
  "BlogPost",
  "CategoryArchive",
  "TagArchive",
  "AuthorArchive",
  "NotFound",
] as const

export type ThemeSurface = (typeof THEME_SURFACES)[number]
