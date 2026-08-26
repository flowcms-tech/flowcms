import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPosts } from "@/db/tables"
import { verifyPreviewToken } from "@/Framework/Auth/previewToken"

/**
 * Resolves the slug in a public URL to the post id a preview token is bound to.
 *
 * Deliberately does NOT filter on `isPublished` — a preview exists precisely so
 * an unpublished post can be read — but it does exclude trashed posts. A token
 * for something in the bin should stop working; the sender's intent was "look
 * at this draft", not "look at the thing I deleted".
 */
export async function getPostIdForPreview(slug: string): Promise<string | null> {
  const row = await db.query.blogPosts.findFirst({
    columns: { id: true },
    where: and(eq(blogPosts.slug, slug), isNull(blogPosts.deletedAt)),
  })
  return row?.id ?? null
}

/**
 * The whole preview check in one call, for `/blog/[slug]`.
 *
 * Order matters: the cheap rejections happen first, so an ordinary reader
 * loading a published post — no `?preview=` at all — costs one string check and
 * no query. Only a request that actually carries a token pays for the lookup.
 *
 * Returns false when PREVIEW_SECRET is unset, because `verifyPreviewToken`
 * fails closed. That is the intended behaviour for an unconfigured deployment:
 * the feature is off, not permissive.
 */
export async function isValidPreviewRequest(
  slug: string,
  token: string | string[] | undefined
): Promise<boolean> {
  // An array means `?preview=a&preview=b`, which no link this app generates
  // produces — treated as malformed rather than trying the first one.
  if (!token || typeof token !== "string") return false

  const postId = await getPostIdForPreview(slug)
  if (!postId) return false

  return verifyPreviewToken(postId, token)
}
