import { htmlToPlainText } from "@/Framework/Functions/sanitizePostContent"
import { publicImageUrl } from "@/Framework/Storage/publicImageUrl"
import { howToStepAnchor } from "@/Themes/contract/runtime/howToStepAnchor"
import { readingTimeMinutes } from "@/Modules/Blog/Posts/Values/contentStats"
import {
  parseSchemaData,
  type HowToSchemaData,
  type ReviewSchemaData,
  type VideoSchemaData,
} from "@/Modules/Blog/Posts/Values/Validations"
import { resolveSeoContext, resolvePrimaryCategory, joinUrl, type SeoContext } from "./buildPostMetadata"
import type { PublicPost, PublicPostSummary, PublicTaxonomy } from "../Types"

/** Google truncates headline around here and flags longer ones. */
const MAX_HEADLINE = 110

/** Stated explicitly because an unset `inLanguage` leaves Google to guess
 *  from the markup.
 *
 *  TODO: this belongs in Settings alongside the rest of the site profile. It is
 *  a hardcoded default rather than a customer value, so it is not a blocker for
 *  general use, but a non-English site currently has to patch this constant. */
const CONTENT_LANGUAGE = "en"

/** `headline`, `articleSection` and `wordCount` are Article-family properties.
 *  Emitting them on a HowTo or a VideoObject is invalid markup that the Rich
 *  Results Test reports, so the builder branches on this rather than shipping
 *  one node shape for every type. */
const ARTICLE_TYPES = new Set(["BlogPosting", "Article", "NewsArticle"])

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
}

/** Reading time as an ISO 8601 duration — "PT5M". `timeRequired` is a
 *  CreativeWork property, so it is valid on every schemaType we emit. */
function isoMinutes(minutes: number): string {
  return `PT${minutes}M`
}

function organization({ base, siteName }: SeoContext) {
  return {
    "@type": "Organization",
    "@id": joinUrl(base, "/#organization"),
    name: siteName,
    url: joinUrl(base, "/"),
  }
}

function breadcrumbs(base: string, id: string, trail: { name: string; path: string }[]) {
  return {
    "@type": "BreadcrumbList",
    "@id": id,
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: joinUrl(base, crumb.path),
    })),
  }
}

/**
 * The post's typed structured-data payload, or null.
 *
 * `parseSchemaData` returns null on a malformed or outdated payload, and that
 * null is honoured all the way through: a post whose `schemaData` no longer
 * validates renders with no type-specific markup at all. Emitting a partial
 * HowTo is a Rich Results *error*; emitting none is a missing enhancement.
 *
 * Exported because `BlogPostModule` renders the same payload visibly. Google
 * penalises structured data describing content the visitor cannot see, so the
 * page and the graph must read from one parse of one field.
 */
export function howToDataFor(post: Pick<PublicPost, "schemaType" | "schemaData">) {
  if (post.schemaType !== "HowTo") return null
  return (parseSchemaData(post.schemaType, post.schemaData) as HowToSchemaData | null) ?? null
}

export function reviewDataFor(post: Pick<PublicPost, "schemaType" | "schemaData">) {
  if (post.schemaType !== "Review") return null
  return (parseSchemaData(post.schemaType, post.schemaData) as ReviewSchemaData | null) ?? null
}

export function videoDataFor(post: Pick<PublicPost, "schemaType" | "schemaData">) {
  if (post.schemaType !== "VideoObject") return null
  return (parseSchemaData(post.schemaType, post.schemaData) as VideoSchemaData | null) ?? null
}

/** Anchor for step N of a rendered HowTo. Shared by the markup's `url` and the
 *  visible list's `id`, so the two genuinely point at the same thing — which is
 *  why it moved to the contract in Phase 7.2 and is only re-exported here. */
export { howToStepAnchor } from "@/Themes/contract/runtime/howToStepAnchor"

/** schema.org `totalTime` must be an ISO 8601 duration; the admin field is free
 *  text ("about an hour"). Emitting the free text produces an invalid value
 *  rather than a helpful one, so anything that isn't a duration is dropped from
 *  the markup — it still renders on the page, where prose is what a reader
 *  wants. */
const ISO_DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$/

function howToNode(data: HowToSchemaData, url: string) {
  return {
    ...(data.totalTime && ISO_DURATION.test(data.totalTime) ? { totalTime: data.totalTime } : {}),
    ...(data.estimatedCost ? { estimatedCost: data.estimatedCost } : {}),
    ...(data.tools.length
      ? { tool: data.tools.map((name) => ({ "@type": "HowToTool", name })) }
      : {}),
    ...(data.supplies.length
      ? { supply: data.supplies.map((name) => ({ "@type": "HowToSupply", name })) }
      : {}),
    step: data.steps.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: step.name,
      text: step.text,
      url: `${url}#${howToStepAnchor(index)}`,
      ...(step.imageKey ? { image: publicImageUrl(step.imageKey) } : {}),
    })),
  }
}

function reviewNode(data: ReviewSchemaData) {
  return {
    itemReviewed: { "@type": data.itemType || "Product", name: data.itemName },
    reviewRating: {
      "@type": "Rating",
      ratingValue: data.rating,
      bestRating: data.bestRating,
      worstRating: data.worstRating,
    },
    ...(data.pros.length
      ? {
          positiveNotes: {
            "@type": "ItemList",
            itemListElement: data.pros.map((name, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name,
            })),
          },
        }
      : {}),
    ...(data.cons.length
      ? {
          negativeNotes: {
            "@type": "ItemList",
            itemListElement: data.cons.map((name, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name,
            })),
          },
        }
      : {}),
  }
}

function videoNode(data: VideoSchemaData, fallbackThumbnail: string) {
  return {
    contentUrl: data.contentUrl,
    ...(data.embedUrl ? { embedUrl: data.embedUrl } : {}),
    thumbnailUrl: data.thumbnailKey ? publicImageUrl(data.thumbnailKey) : fallbackThumbnail,
    uploadDate: data.uploadDate,
    ...(data.duration ? { duration: data.duration } : {}),
  }
}

/**
 * ONE `@graph` per page, with `@id` cross-references.
 *
 * Not a pile of independent <script> blocks: duplicate, unlinked
 * `Organization` nodes on a single page are one of the most common warnings in
 * the Rich Results Test, and a graph whose nodes never reference each other
 * tells a crawler nothing about how the page's entities relate. Every `@id`
 * used as a reference here also exists as a node in the same graph — a
 * dangling reference is worse than an inline duplicate.
 */
export async function buildPostJsonLd(
  post: PublicPost,
  /**
   * Moderated reader questions, merged into the SAME FAQPage node as the
   * hand-authored FAQs rather than emitted as a second one — two FAQPage nodes
   * on one URL is a duplicate-node warning in the Rich Results Test.
   *
   * The caller must be rendering this exact array on the page. `BlogPostModule`
   * takes the same value and passes it to `ReaderQuestions`, which is what
   * keeps the "rendered before marked up" rule true rather than aspirational.
   */
  questions: { id: string; question: string; answer: string }[] = []
) {
  const ctx = await resolveSeoContext()
  const { base, siteName } = ctx
  const url = post.canonicalUrl || joinUrl(base, `/blog/${post.slug}`)
  const primaryCategory = resolvePrimaryCategory(post)
  const breadcrumbId = `${url}#breadcrumb`

  const isArticle = ARTICLE_TYPES.has(post.schemaType)
  const howTo = howToDataFor(post)
  const review = reviewDataFor(post)
  const video = videoDataFor(post)

  const mainNode: Record<string, unknown> = {
    "@type": post.schemaType,
    "@id": `${url}#post`,
    // `headline` belongs to Article; everything else takes `name`.
    ...(isArticle
      ? { headline: truncate(post.title, MAX_HEADLINE) }
      : { name: truncate(post.title, MAX_HEADLINE) }),
    description: post.metaDescription || post.excerpt,
    image: [post.ogImageUrl],
    url,
    // A plain URL, not an inline WebPage node — mainEntityOfPage accepts one,
    // and an inline node with an @id nothing else in the graph defines is the
    // dangling reference described above.
    mainEntityOfPage: url,
    datePublished: post.publishedAt?.toISOString(),
    // contentUpdatedAt ?? publishedAt. NEVER row updatedAt: it bumps on a typo
    // fix, and re-dating unchanged content is what Google treats as
    // manipulative.
    dateModified: (post.contentUpdatedAt ?? post.publishedAt)?.toISOString(),
    // Only a real author carries E-E-A-T fields. The admin-account fallback
    // gets a bare name — asserting a jobTitle or sameAs we don't have would
    // be fabricating credentials in structured data.
    author: {
      "@type": "Person",
      name: post.author.name || siteName,
      ...(post.author.jobTitle ? { jobTitle: post.author.jobTitle } : {}),
      ...(post.author.bio ? { description: post.author.bio } : {}),
      ...(post.author.avatarUrl ? { image: post.author.avatarUrl } : {}),
      ...(post.author.sameAs.length ? { sameAs: post.author.sameAs } : {}),
      ...(post.author.slug ? { url: joinUrl(base, `/blog/author/${post.author.slug}`) } : {}),
    },
    publisher: { "@id": joinUrl(base, "/#organization") },
    breadcrumb: { "@id": breadcrumbId },
    inLanguage: CONTENT_LANGUAGE,
    // Nothing on this blog sits behind a paywall or a signup, and saying so
    // explicitly is what lets Google treat the full text as indexable.
    isAccessibleForFree: true,
    ...(isArticle && primaryCategory ? { articleSection: primaryCategory.name } : {}),
    ...(isArticle && post.wordCount ? { wordCount: post.wordCount } : {}),
    ...(post.wordCount ? { timeRequired: isoMinutes(readingTimeMinutes(post.wordCount)) } : {}),
    ...(post.tags.length ? { keywords: post.tags.map((t) => t.name).join(", ") } : {}),
    // Only when the editor actually chose selectors. A default guessed here
    // would point a voice assistant at whatever the template happens to render
    // today.
    ...(post.speakableSelectors.length
      ? {
          speakable: {
            "@type": "SpeakableSpecification",
            cssSelector: post.speakableSelectors,
          },
        }
      : {}),
    // Type-specific payloads. Each is null when `schemaData` failed to parse,
    // in which case the node stays a plain typed CreativeWork rather than a
    // broken one.
    ...(howTo ? howToNode(howTo, url) : {}),
    ...(review ? reviewNode(review) : {}),
    ...(video ? videoNode(video, post.ogImageUrl) : {}),
  }

  const graph: Record<string, unknown>[] = [
    organization(ctx),
    mainNode,
    breadcrumbs(base, breadcrumbId, [
      { name: "Home", path: "/" },
      { name: "Blog", path: "/blog" },
      ...(primaryCategory
        ? [{ name: primaryCategory.name, path: `/blog/category/${primaryCategory.slug}` }]
        : []),
      { name: post.title, path: `/blog/${post.slug}` },
    ]),
  ]

  // Only when there is something to mark up — and only what is rendered
  // visibly on the page. Structured data describing content a visitor cannot
  // see is a manual-action risk, not a shortcut.
  //
  // Curated FAQs first, then answered reader questions: the FAQs are the
  // deliberate ones, and Google truncates long FAQ lists from the top.
  const faqEntries = [...post.faqs, ...questions]
  if (faqEntries.length > 0) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      url,
      mainEntity: faqEntries.map((entry) => ({
        "@type": "Question",
        name: htmlToPlainText(entry.question),
        acceptedAnswer: { "@type": "Answer", text: htmlToPlainText(entry.answer) },
      })),
    })
  }

  return { "@context": "https://schema.org", "@graph": graph }
}

/** `/blog?page=2` describes page 2, so its CollectionPage has to carry page
 *  2's URL — the same self-canonical rule the metadata builder applies. */
function pagedUrl(base: string, path: string, page: number): string {
  return page > 1 ? `${joinUrl(base, path)}?page=${page}` : joinUrl(base, path)
}

export async function buildBlogIndexJsonLd(posts: PublicPostSummary[], page = 1) {
  const ctx = await resolveSeoContext()
  const { base, siteName } = ctx
  const url = pagedUrl(base, "/blog", page)
  const breadcrumbId = `${joinUrl(base, "/blog")}#breadcrumb`

  return {
    "@context": "https://schema.org",
    "@graph": [
      organization(ctx),
      {
        "@type": "CollectionPage",
        "@id": `${url}#collection`,
        name: `${siteName} Blog`,
        url,
        inLanguage: CONTENT_LANGUAGE,
        isPartOf: { "@id": joinUrl(base, "/#organization") },
        breadcrumb: { "@id": breadcrumbId },
        hasPart: posts.map((post) => ({
          "@type": "BlogPosting",
          headline: truncate(post.title, MAX_HEADLINE),
          url: joinUrl(base, `/blog/${post.slug}`),
          datePublished: post.publishedAt?.toISOString(),
        })),
      },
      breadcrumbs(base, breadcrumbId, [
        { name: "Home", path: "/" },
        { name: "Blog", path: "/blog" },
      ]),
    ],
  }
}

export async function buildTaxonomyJsonLd(
  taxonomy: PublicTaxonomy,
  kind: "category" | "tag",
  posts: PublicPostSummary[],
  page = 1
) {
  const ctx = await resolveSeoContext()
  const { base } = ctx
  const path = `/blog/${kind}/${taxonomy.slug}`
  const url = pagedUrl(base, path, page)
  const breadcrumbId = `${joinUrl(base, path)}#breadcrumb`

  return {
    "@context": "https://schema.org",
    "@graph": [
      organization(ctx),
      {
        "@type": "CollectionPage",
        "@id": `${url}#collection`,
        name: taxonomy.name,
        url,
        ...(taxonomy.archiveIntro ? { description: taxonomy.archiveIntro } : {}),
        inLanguage: CONTENT_LANGUAGE,
        isPartOf: { "@id": joinUrl(base, "/#organization") },
        breadcrumb: { "@id": breadcrumbId },
        hasPart: posts.map((post) => ({
          "@type": "BlogPosting",
          headline: truncate(post.title, MAX_HEADLINE),
          url: joinUrl(base, `/blog/${post.slug}`),
        })),
      },
      breadcrumbs(base, breadcrumbId, [
        { name: "Home", path: "/" },
        { name: "Blog", path: "/blog" },
        { name: taxonomy.name, path },
      ]),
    ],
  }
}
