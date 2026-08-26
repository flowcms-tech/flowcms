import AskQuestionForm from "../Components/AskQuestionForm"
import { getRelatedPosts, getSeriesPosts } from "../Queries/publicBlogQueries"
import { buildTableOfContents, shouldRenderToc } from "../Values/tableOfContents"
import { resolvePrimaryCategory } from "../Values/buildPostMetadata"
import {
  buildPostJsonLd,
  buildBlogIndexJsonLd,
  buildTaxonomyJsonLd,
  howToDataFor,
  reviewDataFor,
  videoDataFor,
} from "../Values/buildJsonLd"
import { buildAuthorJsonLd } from "../Values/buildAuthorJsonLd"
import type {
  PublicPost,
  PublicPostSummary,
  PublicTaxonomy,
} from "../Types"
import type { PublicPostQuestion } from "../Queries/questionQueries"
import type { PublicAuthor } from "../Queries/authorQueries"
import type {
  ArchiveView,
  AuthorArchiveView,
  BlogIndexView,
  BlogPostView,
} from "./types"

export type {
  ArchiveView,
  AuthorArchiveView,
  BlogIndexView,
  BlogPostView,
  TocView,
  HowToData,
  ReviewData,
  VideoData,
} from "./types"

/**
 * Build the view models the public surfaces render from.
 *
 * These are the only place that queries and structured data meet presentation.
 * Routes call them; themes consume the result. See `./types.ts` for why the
 * boundary sits here rather than inside the components.
 */

export async function buildBlogPostView(
  post: PublicPost,
  questions: PublicPostQuestion[] = [],
): Promise<BlogPostView> {
  // Hoisted out of BlogPostModule in Phase 6.0. They were awaited inside the
  // component, which made the component a data fetcher — and would have made
  // every future theme one too.
  const [related, seriesPosts] = await Promise.all([
    getRelatedPosts(post),
    post.seriesId ? getSeriesPosts(post.seriesId) : Promise.resolve([]),
  ])

  const { html, headings } = buildTableOfContents(post.content)

  return {
    post,
    questions,
    related,
    seriesPosts,
    toc: { html, headings, hasToc: shouldRenderToc(headings) },
    primaryCategory: resolvePrimaryCategory(post),
    howTo: howToDataFor(post),
    review: reviewDataFor(post),
    video: videoDataFor(post),
    // Rendered here, placed by the theme.
    //
    // Until Phase 7.2 the theme imported `AskQuestionForm` from the contract
    // and rendered it itself. That could not survive publication: it is a
    // `'use client'` feature built from five shared admin inputs, a Radix
    // provider, react-hook-form, Zod and a CAPTCHA, and packaging it would have
    // shipped a second copy of the admin component library to every theme
    // author. Handing over the node keeps the CAPTCHA and the rate-limited
    // submit path inside core, where a theme cannot weaken them, and leaves the
    // theme the only decision it wanted: whether to show it, and where.
    //
    // No className: spacing is the theme's, so it wraps rather than configures.
    askQuestion: <AskQuestionForm postId={post.id} />,
    // The same `questions` array goes to the graph and to the page. Passing it
    // to only one of the two is the failure mode this ordering prevents.
    jsonLd: await buildPostJsonLd(post, questions),
  }
}

export async function buildBlogIndexView(
  posts: PublicPostSummary[],
  page: number,
  totalPages: number,
): Promise<BlogIndexView> {
  return { posts, page, totalPages, jsonLd: await buildBlogIndexJsonLd(posts, page) }
}

export async function buildArchiveView(
  taxonomy: PublicTaxonomy,
  kind: "category" | "tag",
  posts: PublicPostSummary[],
  page: number,
  totalPages: number,
): Promise<ArchiveView> {
  return {
    taxonomy,
    kind,
    posts,
    page,
    totalPages,
    jsonLd: await buildTaxonomyJsonLd(taxonomy, kind, posts, page),
  }
}

export async function buildAuthorArchiveView(
  author: PublicAuthor,
  posts: PublicPostSummary[],
  page: number,
  totalPages: number,
): Promise<AuthorArchiveView> {
  return {
    author,
    posts,
    page,
    totalPages,
    jsonLd: await buildAuthorJsonLd(author, posts, page),
  }
}
