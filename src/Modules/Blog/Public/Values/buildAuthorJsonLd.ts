import type { Metadata } from "next"
import { resolveSeoContext, joinUrl } from "./buildPostMetadata"
import type { PublicAuthor } from "../Queries/authorQueries"
import type { PublicPostSummary } from "../Types"

/**
 * Metadata and structured data for `/blog/author/[slug]`.
 *
 * Colocated because the two share every fallback: a title the JSON-LD and the
 * `<title>` disagree on is the exact drift `buildPostMetadata` exists to
 * prevent, and there is no third consumer that would want one without the
 * other.
 *
 * `ProfilePage` wrapping a `Person` is the pairing Google documents for an
 * author page — a bare `Person` node describes the human but says nothing
 * about what this URL is, and a bare `CollectionPage` loses the E-E-A-T signal
 * the author table exists to carry.
 */

const MAX_HEADLINE = 110

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
}

function authorPath(slug: string, page: number): string {
  return page > 1 ? `/blog/author/${slug}?page=${page}` : `/blog/author/${slug}`
}

/**
 * Paginated archives are indexable and **self-canonical**.
 *
 * Not the common advice, so stated plainly: `noindex` on page 2+ eventually
 * drops those pages and, because `noindex` decays into `nofollow`, strips the
 * crawl path to the older posts they link to. Canonicalising page 2 to page 1
 * is also wrong — Google reads it as a duplicate-content claim about content
 * that is genuinely different. Distinct titles per page, each canonical to
 * itself, is the correct handling.
 */
export async function buildAuthorMetadata(
  author: PublicAuthor,
  page: number,
  totalPages: number
): Promise<Metadata> {
  const { base, siteName } = await resolveSeoContext()

  const baseTitle = author.metaTitle || `${author.name} — ${siteName} Blog`
  const title = page > 1 ? `${baseTitle} — Page ${page} of ${totalPages}` : baseTitle

  const description =
    author.metaDescription ||
    author.bio ||
    `Articles written by ${author.name}${author.jobTitle ? `, ${author.jobTitle}` : ""} on the ${siteName} blog.`

  // A hand-set canonicalUrl is honoured on page 1 only. Pointing every page of
  // a paginated archive at one URL is the duplicate-content claim described
  // above, and an admin filling in one field cannot have meant that.
  const canonical =
    page > 1 || !author.canonicalUrl
      ? joinUrl(base, authorPath(author.slug, page))
      : author.canonicalUrl

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { type: "profile", siteName, url: canonical, title, description },
    // follow stays true on noindex so link equity still reaches the posts.
    robots: author.isIndexable ? undefined : { index: false, follow: true },
  }
}

export async function buildAuthorJsonLd(
  author: PublicAuthor,
  posts: PublicPostSummary[],
  page: number
) {
  const { base, siteName } = await resolveSeoContext()
  const url = joinUrl(base, authorPath(author.slug, page))
  const personId = `${joinUrl(base, `/blog/author/${author.slug}`)}#person`

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": joinUrl(base, "/#organization"),
        name: siteName,
        url: joinUrl(base, "/"),
      },
      {
        "@type": "ProfilePage",
        "@id": `${url}#profile`,
        url,
        name: author.name,
        // mainEntity, not a second copy of the Person: one node, referenced by
        // @id, keeps the graph connected instead of a bag of duplicated blobs.
        mainEntity: { "@id": personId },
        hasPart: posts.map((post) => ({
          "@type": "BlogPosting",
          headline: truncate(post.title, MAX_HEADLINE),
          url: joinUrl(base, `/blog/${post.slug}`),
          datePublished: post.publishedAt?.toISOString(),
        })),
      },
      {
        "@type": "Person",
        "@id": personId,
        name: author.name,
        url: joinUrl(base, `/blog/author/${author.slug}`),
        // Every field below is asserted only when it is actually stored.
        // Inventing a jobTitle or a credential in structured data would be
        // fabricating exactly the expertise signal this markup claims to
        // demonstrate.
        ...(author.jobTitle ? { jobTitle: author.jobTitle } : {}),
        ...(author.bio ? { description: author.bio } : {}),
        ...(author.credentials ? { hasCredential: author.credentials } : {}),
        ...(author.avatarUrl ? { image: author.avatarUrl } : {}),
        ...(author.sameAs.length ? { sameAs: author.sameAs } : {}),
        worksFor: { "@id": joinUrl(base, "/#organization") },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { name: "Home", path: "/" },
          { name: "Blog", path: "/blog" },
          { name: author.name, path: `/blog/author/${author.slug}` },
        ].map((crumb, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: crumb.name,
          item: joinUrl(base, crumb.path),
        })),
      },
    ],
  }
}
