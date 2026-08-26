import type { Metadata } from "next"
import { notFound, permanentRedirect, redirect } from "next/navigation"
import { buildBlogPostView } from "@/Modules/Blog/Public/ViewModels"
import { resolveSurface } from "@/Themes/resolver"
import ThemeShell from "@/Modules/Public/Components/ThemeShell"
import { getPublishedPostBySlug } from "@/Modules/Blog/Public/Queries/publicBlogQueries"
import { getPublishedQuestionsForPost } from "@/Modules/Blog/Public/Queries/questionQueries"
import { isValidPreviewRequest } from "@/Modules/Blog/Public/Queries/previewQueries"
import { buildPostMetadata } from "@/Modules/Blog/Public/Values/buildPostMetadata"
import { findRedirect } from "@/db/redirectMaintenance"
import { recordNotFound } from "@/db/notFoundLogging"

// Dynamic so publishDueScheduledPosts() runs per request — there is no cron,
// and a scheduled post must go live when someone actually asks for it.
export const dynamic = "force-dynamic"

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ preview?: string }>
}

/**
 * Resolve the post, falling back to an unpublished one ONLY behind a verified
 * preview token.
 *
 * Shared by the page and `generateMetadata` so the two can never disagree about
 * whether a draft is visible — a metadata pass that resolved the post while the
 * page 404'd (or worse, the reverse) is how a draft ends up with indexable tags.
 */
async function resolvePost(slug: string, previewToken: string | undefined) {
  const published = await getPublishedPostBySlug(slug)
  if (published) return { post: published, isPreview: false }

  if (await isValidPreviewRequest(slug, previewToken)) {
    const draft = await getPublishedPostBySlug(slug, { includeUnpublished: true })
    if (draft) return { post: draft, isPreview: true }
  }

  return { post: null, isPreview: false }
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const { preview } = await searchParams
  const { post, isPreview } = await resolvePost(slug, preview)
  if (!post) return {}

  const metadata = await buildPostMetadata(post)
  if (!isPreview) return metadata

  // A leaked preview URL must never be indexable — this is the entire risk of
  // the feature. `next.config.ts` also sets X-Robots-Tag on the response; this
  // is the in-document half, and `follow: false` too because a preview's links
  // point at other unpublished work.
  return { ...metadata, robots: { index: false, follow: false } }
}

export default async function BlogPostPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const { preview } = await searchParams
  const { post } = await resolvePost(slug, preview)

  if (!post) {
    // Redirects resolve here rather than in src/proxy.ts, which must never
    // transitively import the DB client. The extra query only runs on the
    // 404 path, so the common case is unaffected.
    const match = await findRedirect(`/blog/${slug}`)
    if (match) {
      // Next only emits 308/307 from a server component, so a stored 301 goes
      // out as 308 — equivalent to Google for passing on ranking signals.
      const isPermanent = match.statusCode === 301 || match.statusCode === 308
      if (isPermanent) permanentRedirect(match.toPath)
      redirect(match.toPath)
    }
    // Best-effort: never throws, and only runs once no redirect matched.
    await recordNotFound(`/blog/${slug}`)
    notFound()
  }

  // Moderated reader questions join the hand-authored FAQs. They are fetched
  // here and passed to BOTH the module and the JSON-LD builder, because the
  // rule is that nothing enters the FAQPage graph that isn't rendered on the
  // page — passing them to only one of the two is the failure mode.
  const questions = await getPublishedQuestionsForPost(post.id)

  const view = await buildBlogPostView(post, questions)

  const { Component: BlogPost, settings } = await resolveSurface("BlogPost")

  return (
    <ThemeShell>
      <BlogPost {...view} settings={settings} />
    </ThemeShell>
  )
}
