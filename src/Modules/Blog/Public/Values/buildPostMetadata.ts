import type { Metadata } from "next"
import type { PublicPost, PublicTaxonomy } from "../Types"
import { getBaseUrl, getBrand, getMetaTemplates } from "@/Framework/Settings/SettingsService"
import { renderMetaTemplate, type MetaTemplateVars } from "./metaTemplates"

export interface SeoContext {
  base: string
  siteName: string
  /**
   * The operator's own one-line description of the site, or null.
   *
   * There is deliberately no default. The value that used to stand in for it
   * was a customer's marketing sentence, and every surface that wanted a
   * description simply hardcoded that sentence — which is how a locksmith blurb
   * ended up in the meta tags and RSS feed of every FlowCMS install.
   */
  tagline: string | null
}

/** Resolves once per call instead of hitting Settings for every URL in a
 *  page's metadata or JSON-LD graph — pass the result down via `joinUrl`. */
export async function resolveSeoContext(): Promise<SeoContext> {
  const [base, brand] = await Promise.all([getBaseUrl(), getBrand()])
  return { base, siteName: brand.siteName, tagline: brand.tagline }
}

export function joinUrl(base: string, path: string): string {
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}

export async function absoluteUrl(path: string): Promise<string> {
  const { base } = await resolveSeoContext()
  return joinUrl(base, path)
}

/**
 * The post's primary category, with the deterministic fallback.
 *
 * `primaryCategoryId` when it still resolves to a linked category, otherwise
 * the alphabetically-first one — `categories` is sorted by name in the query
 * layer precisely so this fallback cannot change between deploys. It drives the
 * breadcrumb trail, `articleSection`, and the `%category%` template variable,
 * all three of which have to agree.
 */
export function resolvePrimaryCategory(
  post: Pick<PublicPost, "categories" | "primaryCategoryId">
): { id: string; name: string; slug: string } | null {
  return (
    post.categories.find((category) => category.id === post.primaryCategoryId) ??
    post.categories[0] ??
    null
  )
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return ""
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "long" }).format(date)
}

/**
 * Appends "— Page N of M" unless the configured template already places
 * `%page%` itself.
 *
 * A template author who used the variable has chosen where the page number
 * goes; one who didn't still needs a unique title per page, because that
 * uniqueness is the whole reason §5.9 keeps paginated archives indexable
 * instead of noindexing them.
 */
function withPageSuffix(title: string, template: string, page: number, totalPages: number): string {
  if (page <= 1 || template.includes("%page%")) return title
  return `${title} — Page ${page} of ${totalPages}`
}

/**
 * Every fallback chain lives here so no page reimplements one and drifts.
 *
 *   title       = metaTitle    ?? settings template ?? title
 *   description = metaDescription ?? settings template ?? excerpt
 *   canonical   = canonicalUrl ?? the post's own URL
 *   ogImage     = ogImageKey   ?? featuredImageKey   (resolved upstream)
 *
 * Meta Title/Description double as the social (OG/Twitter) title and
 * description too — there is deliberately no separate override for those,
 * so there's exactly one pair of fields to fill in, not two that drift out
 * of sync with each other.
 *
 * The template only fills blanks: a per-post value always wins, so a site-wide
 * rename never silently rewrites a title someone typed by hand.
 */
export async function buildPostMetadata(post: PublicPost): Promise<Metadata> {
  const [{ base, siteName }, templates] = await Promise.all([
    resolveSeoContext(),
    getMetaTemplates(),
  ])

  const primaryCategory = resolvePrimaryCategory(post)
  const modified = post.contentUpdatedAt ?? post.publishedAt

  const vars: MetaTemplateVars = {
    title: post.title,
    sitename: siteName,
    sep: templates.separator,
    excerpt: post.excerpt,
    category: primaryCategory?.name ?? "",
    primary_category: primaryCategory?.name ?? "",
    tag: post.tags[0]?.name ?? "",
    author: post.author.name,
    date: formatDate(post.publishedAt),
    modified: formatDate(modified),
    focus_keyword: post.focusKeyword ?? "",
  }

  // `|| post.title` is the last resort: a template that renders to nothing
  // (every variable in it empty) must not produce a blank <title>.
  const title = post.metaTitle || renderMetaTemplate(templates.postTitle, vars) || post.title
  const description =
    post.metaDescription || renderMetaTemplate(templates.postDescription, vars) || post.excerpt
  const canonical = post.canonicalUrl || joinUrl(base, `/blog/${post.slug}`)

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "article",
      siteName,
      url: canonical,
      title,
      description,
      images: [{ url: post.ogImageUrl, width: 1200, height: 630, alt: post.featuredImageAltText }],
      publishedTime: post.publishedAt?.toISOString(),
      // contentUpdatedAt ?? publishedAt. Deliberately NOT row updatedAt — that
      // bumps on typo fixes, and re-dating unchanged content is exactly the
      // pattern Google treats as manipulative.
      modifiedTime: modified?.toISOString(),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [post.ogImageUrl],
    },
    // follow stays true on noindex so link equity still reaches the service pages.
    robots: post.isIndexable ? undefined : { index: false, follow: true },
  }
}

/** `/blog?page=2`, not `/blog`. See the pagination note on
 *  `buildTaxonomyMetadata`. */
function pagedPath(basePath: string, page: number): string {
  return page > 1 ? `${basePath}?page=${page}` : basePath
}

/**
 * Paginated archives are **indexable** and **self-canonical**.
 *
 * This is the opposite of the advice you will find repeated everywhere, so it
 * is stated rather than assumed. `noindex` on page 2+ eventually drops those
 * pages from the index and, because `noindex` decays into `nofollow`, strips
 * the crawl path to the older posts they link to. Canonicalising page 2 back to
 * page 1 is also wrong: Google reads it as a duplicate-content claim about
 * content that is genuinely different. Distinct titles per page, each canonical
 * to itself, is the correct handling — please do not "fix" this.
 *
 * The only noindex applied here is the taxonomy's own flag, and the computed
 * empty-archive rule below it.
 */
export async function buildTaxonomyMetadata(
  taxonomy: PublicTaxonomy,
  kind: "category" | "tag",
  page = 1,
  totalPages = 1
): Promise<Metadata> {
  const [{ base, siteName }, templates] = await Promise.all([
    resolveSeoContext(),
    getMetaTemplates(),
  ])

  const template = kind === "category" ? templates.categoryTitle : templates.tagTitle
  const vars: MetaTemplateVars = {
    title: taxonomy.name,
    sitename: siteName,
    sep: templates.separator,
    excerpt: taxonomy.archiveIntro ?? taxonomy.description ?? "",
    category: kind === "category" ? taxonomy.name : "",
    primary_category: kind === "category" ? taxonomy.name : "",
    tag: kind === "tag" ? taxonomy.name : "",
    page: String(page),
  }

  const baseTitle =
    taxonomy.metaTitle ||
    renderMetaTemplate(template, vars) ||
    `${taxonomy.name} — ${siteName} Blog`
  const title = withPageSuffix(baseTitle, template, page, totalPages)

  const description =
    taxonomy.metaDescription ||
    taxonomy.description ||
    `Articles about ${taxonomy.name} from the ${siteName} blog.`

  const basePath = `/blog/${kind}/${taxonomy.slug}`
  // A hand-set canonicalUrl is honoured on page 1 only. Pointing every page of
  // a paginated archive at one URL is the duplicate-content claim described
  // above, and an admin filling in one field cannot have meant that.
  const canonical =
    page > 1 || !taxonomy.canonicalUrl
      ? joinUrl(base, pagedPath(basePath, page))
      : taxonomy.canonicalUrl

  // An archive with zero published, indexable posts is noindex regardless of
  // its own flag — it is a thin page by definition, and the count is computed
  // per request so it corrects itself the moment a post is published.
  const indexable = taxonomy.isIndexable && taxonomy.indexablePostCount > 0

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { type: "website", siteName, url: canonical, title, description },
    // follow stays true on noindex so link equity still reaches the posts.
    robots: indexable ? undefined : { index: false, follow: true },
  }
}

/**
 * `/blog` itself. Same pagination rules as the taxonomy archives — indexable,
 * self-canonical, unique title per page.
 *
 * Deliberately NOT the category or tag template: those describe an archive of
 * one taxonomy term, and an owner who rewrites theirs to "Articles about
 * %title%" would get "Articles about Blog" here. Only the separator setting is
 * shared, since that is a site-wide typographic choice rather than a per-
 * archive one.
 */
const BLOG_INDEX_TITLE_TEMPLATE = "%title% %sep% %sitename%"

/**
 * The `<description>` for a feed `<channel>`.
 *
 * Separate from the metadata path above because the two degrade differently.
 * RSS 2.0 requires `<description>` on `<channel>`, so an unconfigured site
 * still needs something — but "something" must not be a claim about what the
 * site is about. It names the site and stops there.
 *
 * Pure, so the feed routes can be checked without a database.
 */
export function feedChannelDescription(siteName: string, tagline: string | null): string {
  const configured = tagline?.trim()
  return configured ? configured : `Latest posts from ${siteName}`
}

export async function buildBlogIndexMetadata(page = 1, totalPages = 1): Promise<Metadata> {
  const [{ base, siteName, tagline }, templates] = await Promise.all([
    resolveSeoContext(),
    getMetaTemplates(),
  ])

  const vars: MetaTemplateVars = {
    title: "Blog",
    sitename: siteName,
    sep: templates.separator,
    page: String(page),
  }

  const baseTitle = renderMetaTemplate(BLOG_INDEX_TITLE_TEMPLATE, vars) || `Blog — ${siteName}`
  const title = withPageSuffix(baseTitle, BLOG_INDEX_TITLE_TEMPLATE, page, totalPages)
  const canonical = joinUrl(base, pagedPath("/blog", page))

  // Omitted rather than filled in when unset. A search engine writes a better
  // description from the page than any filler we could invent, and inventing
  // one is exactly how the previous hardcoded sentence got here.
  const description = tagline?.trim() || undefined

  return {
    title,
    ...(description ? { description } : {}),
    alternates: { canonical },
    openGraph: {
      type: "website",
      siteName,
      url: canonical,
      title,
      ...(description ? { description } : {}),
    },
  }
}
