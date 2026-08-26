import { NextRequest, NextResponse } from "next/server"
import { eq, like } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPostCategories, blogPostFaqs, blogPosts, blogPostTags } from "@/db/tables"
import { CacheService } from "@/Framework/Redis/CacheService"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { insertReturning } from "@/db/writes"

/**
 * Clone a post as a draft.
 *
 * Everything that describes the *content* comes across — body, excerpt, images,
 * metadata, keywords, schema payload, categories, tags, FAQs. Everything that
 * describes the original's *history or standing* does not: `publishedAt`,
 * `scheduledPublishAt`, revisions, `seoScore`, `contentUpdatedAt`, and the
 * whole review block. Those are facts about the post that was published, and
 * carrying them onto a draft that has never been live makes every one of them a
 * lie — a "last substantively updated" date on a page nobody has read, an
 * approval nobody granted.
 */

/** Slug column is `text`, but `createBlogPostSchema` caps a slug at 200 and the
 *  copy has to stay editable through the same form. */
const MAX_SLUG_LENGTH = 200

/**
 * `slug-copy`, then `slug-copy-2`, `slug-copy-3`, …
 *
 * Checked against the database rather than assumed, because the third copy of a
 * post is a real thing an editor does and a unique-constraint violation on
 * `slug` would surface as a 500 on a button that looks like it should always
 * work.
 */
async function nextAvailableSlug(originalSlug: string): Promise<string> {
  // Truncate the stem, not the suffix — the suffix is the part that makes it
  // unique, so trimming that would defeat the loop below.
  const stem = originalSlug.slice(0, MAX_SLUG_LENGTH - "-copy-99".length)

  const taken = new Set(
    (await db.query.blogPosts.findMany({ where: like(blogPosts.slug, `${stem}-copy%`) })).map(
      (row) => row.slug
    )
  )

  if (!taken.has(`${stem}-copy`)) return `${stem}-copy`
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${stem}-copy-${n}`
    if (!taken.has(candidate)) return candidate
  }
  // Past 99 copies of one post something has gone wrong upstream; a random
  // suffix still succeeds rather than failing the request.
  return `${stem}-copy-${crypto.randomUUID().slice(0, 8)}`
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params

  const source = await db.query.blogPosts.findFirst({ where: eq(blogPosts.id, id) })
  if (!source) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }
  if (source.deletedAt) {
    return NextResponse.json(
      { message: ["Restore this post from the trash before duplicating it"] },
      { status: 422 }
    )
  }

  const slug = await nextAvailableSlug(source.slug)
  const title = `${source.title} (Copy)`.slice(0, 200)

  const created = await db.transaction(async (tx) => {
    const post = await insertReturning(blogPosts, {
        title,
        slug,
        excerpt: source.excerpt,
        // Already sanitized on the way into the original, so re-running the
        // sanitizer here would only risk a second pass changing stored HTML the
        // editor has already approved.
        content: source.content,
        featuredImageKey: source.featuredImageKey,
        featuredImageAltText: source.featuredImageAltText,
        ogImageKey: source.ogImageKey,
        // The creating admin is whoever clicked Duplicate — an audit trail, not
        // a byline. The byline itself carries over.
        authorId: session.user!.id!,
        authorProfileId: source.authorProfileId,

        // A copy is always a draft, and never inherits a schedule. Both of those
        // would put an unreviewed duplicate of a live page on the public site.
        isPublished: false,
        publishedAt: null,
        scheduledPublishAt: null,

        metaTitle: source.metaTitle,
        metaDescription: source.metaDescription,
        /**
         * canonicalUrl is CLEARED, never copied.
         *
         * A duplicate that inherits the original's canonical tells Google to
         * consolidate this page's signals onto the *original* — so the new post
         * can never rank, and any work done on it accrues to a page it is not.
         * That is the precise failure mode duplication is supposed to help you
         * avoid, and it is invisible: the page renders perfectly and simply
         * never appears in search.
         */
        canonicalUrl: null,
        isIndexable: source.isIndexable,

        focusKeyword: source.focusKeyword,
        secondaryKeywords: source.secondaryKeywords,
        /** Not copied. The score is a judgement about a specific slug, title,
         *  and canonical, and this copy has a different one of each. It is
         *  recomputed on the copy's first save. */
        seoScore: null,
        // These two are pure functions of the body, which is identical, so
        // carrying them over is the honest answer rather than a stale one.
        readabilityScore: source.readabilityScore,
        wordCount: source.wordCount,
        /** Not copied — it means "the published content changed after
         *  publication", and this one has never been published. */
        contentUpdatedAt: null,

        isCornerstone: source.isCornerstone,
        seriesId: source.seriesId,
        // Position is not copied: two posts claiming to be part 3 of the same
        // series is a worse default than one part with no stated position.
        seriesPosition: null,
        primaryCategoryId: source.primaryCategoryId,

        schemaType: source.schemaType,
        schemaData: source.schemaData,
        speakableSelectors: source.speakableSelectors,

        // The review block is deliberately left at its column defaults. An
        // approval was granted for the post that was reviewed, not for a copy of
        // it, and inheriting one would let an unread draft through the queue.
      })

    const [categoryLinks, tagLinks, faqs] = await Promise.all([
      tx.query.blogPostCategories.findMany({ where: eq(blogPostCategories.postId, id) }),
      tx.query.blogPostTags.findMany({ where: eq(blogPostTags.postId, id) }),
      tx.query.blogPostFaqs.findMany({ where: eq(blogPostFaqs.postId, id) }),
    ])

    if (categoryLinks.length > 0) {
      await tx.insert(blogPostCategories).values(
        categoryLinks.map((link) => ({ postId: post.id, categoryId: link.categoryId }))
      )
    }
    if (tagLinks.length > 0) {
      await tx.insert(blogPostTags).values(
        tagLinks.map((link) => ({ postId: post.id, tagId: link.tagId }))
      )
    }
    if (faqs.length > 0) {
      await tx.insert(blogPostFaqs).values(
        faqs.map((faq) => ({
          postId: post.id,
          question: faq.question,
          answer: faq.answer,
          priority: faq.priority,
        }))
      )
    }

    return post
  })

  await CacheService.delPattern("blog-posts:*")

  // Recorded against the *copy*, with the source named in the summary. The copy
  // is the row that now exists and the one someone will later ask "where did
  // this come from" about.
  await recordActivity({
    actor: session.user,
    action: "duplicated",
    entityType: "post",
    entityId: created.id,
    entityLabel: created.title,
    summary: `Duplicated from "${source.title}" as a draft`,
    metadata: { sourcePostId: id },
  })

  // No publish hook: the copy is a draft with no public URL, and revisions are
  // not copied either — the copy's history starts at its first save.
  return NextResponse.json({
    data: { id: created.id, title: created.title, slug: created.slug },
    message: "Blog post duplicated",
  })
}
