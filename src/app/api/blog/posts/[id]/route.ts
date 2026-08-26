import { NextRequest, NextResponse } from "next/server"
import { desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db/client"
import { authors, blogCategories, blogPostCategories, blogPostFaqs, blogPostRevisions, blogPosts, blogPostTags, blogSeries, blogTags, users } from "@/db/tables"
import { StorageService } from "@/Framework/Storage/StorageService"
import { updateBlogPostSchema } from "@/Modules/Blog/Posts/Values/Validations"
import { publishDueScheduledPosts } from "@/db/blogPostScheduling"
import { sanitizePostContent } from "@/Framework/Functions/sanitizePostContent"
import { upsertRedirectWithFlattening } from "@/db/redirectMaintenance"
import { REVISION_RETENTION } from "@/db/schema/blogPostRevisions"
import { getActiveLocksByPostIds, getBlockingLock, lockConflictMessage } from "@/db/postLocks"
import { getRedirectTargetsBySlugs } from "@/db/redirectMaintenance"
import { CacheService, ADMIN_CACHE_TTL_SECONDS } from "@/Framework/Redis/CacheService"
import { countWords } from "@/Modules/Blog/Posts/Values/contentStats"
import { analyseSeo } from "@/Modules/Blog/Posts/Values/seoAnalysis"
import { analyseReadability } from "@/Modules/Blog/Posts/Values/readability"
import { getBaseUrl } from "@/Framework/Settings/SettingsService"
import { onPostPublished, onPostUnpublished } from "@/Modules/Blog/Posts/Services/PublishHooks"
import {
  canEditPost,
  canPermanentlyDeletePost,
  canPublish,
  canTrashPost,
  resolveRole,
} from "@/Framework/Auth/permissions"
import { changedFieldLabels, recordActivity, summariseChanges } from "@/db/activityLog"
import { POST_FIELD_LABELS } from "@/Framework/Activity/fieldLabels"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { updateReturning } from "@/db/writes"

const IMAGE_URL_TTL_SECONDS = 3600

type PostRow = typeof blogPosts.$inferSelect

/**
 * Reads one of the JSON-array columns (`secondaryKeywords`,
 * `speakableSelectors`) back into an array.
 *
 * Never throws, and never propagates a bad row. A single post whose column was
 * hand-edited, half-written, or migrated from an older shape would otherwise
 * 500 the endpoint — taking down the admin screen that is the only place to fix
 * it from. An empty array is a survivable lie; a blank page is not.
 */
function parseStringArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

type SerializedPost = Awaited<ReturnType<typeof serializePosts>>[number]

/**
 * Deliberately excludes lockedBy/lockedAt/redirectTo — this is the function
 * whose output is cached (see GET below), and neither of those may ever be
 * stale: a lock reflects "right now" (see src/db/postLocks.ts) and caching
 * it would undermine post locking. attachLiveFields fetches both fresh on
 * every request, cache hit or miss.
 */
async function serializePosts(rows: PostRow[]) {
  if (rows.length === 0) return []

  const postIds = rows.map((row) => row.id)
  // Reviewers come back in the same query as creators — the approving editor is
  // usually a different account, and a second round trip for one name would be
  // the only extra query the editorial columns cost.
  const relatedUserIds = Array.from(
    new Set(rows.flatMap((row) => [row.authorId, row.reviewedById]).filter((id): id is string => !!id))
  )
  const seriesIds = Array.from(
    new Set(rows.map((row) => row.seriesId).filter((id): id is string => !!id))
  )

  const [postCategoryLinks, postTagLinks, categories, tags, adminUsers, authorRows, seriesRows] = await Promise.all([
    db.query.blogPostCategories.findMany({ where: inArray(blogPostCategories.postId, postIds) }),
    db.query.blogPostTags.findMany({ where: inArray(blogPostTags.postId, postIds) }),
    db.query.blogCategories.findMany(),
    db.query.blogTags.findMany(),
    db.query.users.findMany({ where: inArray(users.id, relatedUserIds) }),
    db.query.authors.findMany(),
    seriesIds.length > 0
      ? db.query.blogSeries.findMany({ where: inArray(blogSeries.id, seriesIds) })
      : Promise.resolve([]),
  ])

  const authorById = new Map(authorRows.map((a) => [a.id, a]))
  const seriesById = new Map(seriesRows.map((s) => [s.id, s]))

  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const tagById = new Map(tags.map((t) => [t.id, t]))
  const adminUserById = new Map(adminUsers.map((u) => [u.id, u]))

  const categoriesByPost = new Map<string, { id: string; name: string }[]>()
  for (const link of postCategoryLinks) {
    const category = categoryById.get(link.categoryId)
    if (!category) continue
    const list = categoriesByPost.get(link.postId) ?? []
    list.push({ id: category.id, name: category.name })
    categoriesByPost.set(link.postId, list)
  }

  const tagsByPost = new Map<string, { id: string; name: string }[]>()
  for (const link of postTagLinks) {
    const tag = tagById.get(link.tagId)
    if (!tag) continue
    const list = tagsByPost.get(link.postId) ?? []
    list.push({ id: tag.id, name: tag.name })
    tagsByPost.set(link.postId, list)
  }

  return Promise.all(
    rows.map(async (row) => {
      const createdBy = adminUserById.get(row.authorId)
      const featuredImageUrl = await StorageService.getPresignedDownloadUrl(row.featuredImageKey, IMAGE_URL_TTL_SECONDS)

      return {
        id: row.id,
        title: row.title,
        slug: row.slug,
        excerpt: row.excerpt,
        content: row.content,
        featuredImageKey: row.featuredImageKey,
        featuredImageUrl,
        featuredImageAltText: row.featuredImageAltText,
        ogImageKey: row.ogImageKey,
        isIndexable: row.isIndexable,
        deletedAt: row.deletedAt,
        createdBy: createdBy
          ? { id: createdBy.id, name: createdBy.name ?? "" }
          : { id: row.authorId, name: "" },
        authorProfileId: row.authorProfileId,
        author: row.authorProfileId
          ? (() => {
              const a = authorById.get(row.authorProfileId)
              return a ? { id: a.id, name: a.name, jobTitle: a.jobTitle } : null
            })()
          : null,
        isPublished: row.isPublished,
        publishedAt: row.publishedAt,
        scheduledPublishAt: row.scheduledPublishAt,
        metaTitle: row.metaTitle,
        metaDescription: row.metaDescription,
        canonicalUrl: row.canonicalUrl,
        categories: categoriesByPost.get(row.id) ?? [],
        tags: tagsByPost.get(row.id) ?? [],

        focusKeyword: row.focusKeyword,
        secondaryKeywords: parseStringArray(row.secondaryKeywords),
        seoScore: row.seoScore,
        readabilityScore: row.readabilityScore,

        wordCount: row.wordCount,
        contentUpdatedAt: row.contentUpdatedAt,
        isCornerstone: row.isCornerstone,
        seriesId: row.seriesId,
        series: row.seriesId
          ? (() => {
              const s = seriesById.get(row.seriesId)
              return s ? { id: s.id, name: s.name } : null
            })()
          : null,
        seriesPosition: row.seriesPosition,

        primaryCategoryId: row.primaryCategoryId,

        schemaType: row.schemaType,
        // Handed back as the raw string, not parsed: the shape depends on
        // schemaType and only `parseSchemaData` knows the mapping.
        schemaData: row.schemaData,
        speakableSelectors: parseStringArray(row.speakableSelectors),

        reviewStatus: row.reviewStatus,
        reviewedBy: row.reviewedById
          ? (() => {
              const u = adminUserById.get(row.reviewedById)
              return u ? { id: u.id, name: u.name ?? "" } : null
            })()
          : null,
        reviewedAt: row.reviewedAt,
        reviewNote: row.reviewNote,
      }
    })
  )
}

/** The archive slugs a publish/unpublish has to invalidate alongside the post
 *  itself. Read here rather than inside the hook so `PublishHooks.ts` stays
 *  free of database access — the module boundary is the reason it takes plain
 *  data. */
async function collectHookTaxonomy(postId: string, authorProfileId: string | null) {
  const [categoryLinks, tagLinks, author] = await Promise.all([
    db.query.blogPostCategories.findMany({ where: eq(blogPostCategories.postId, postId) }),
    db.query.blogPostTags.findMany({ where: eq(blogPostTags.postId, postId) }),
    authorProfileId
      ? db.query.authors.findFirst({ where: eq(authors.id, authorProfileId) })
      : Promise.resolve(undefined),
  ])

  const categoryIds = categoryLinks.map((link) => link.categoryId)
  const tagIds = tagLinks.map((link) => link.tagId)

  const [categoryRows, tagRows] = await Promise.all([
    categoryIds.length > 0
      ? db.query.blogCategories.findMany({ where: inArray(blogCategories.id, categoryIds) })
      : Promise.resolve([]),
    tagIds.length > 0
      ? db.query.blogTags.findMany({ where: inArray(blogTags.id, tagIds) })
      : Promise.resolve([]),
  ])

  return {
    categorySlugs: categoryRows.map((category) => category.slug),
    tagSlugs: tagRows.map((tag) => tag.slug),
    authorSlug: author?.slug ?? null,
  }
}

/** Merges in the two fields serializePosts leaves out — always a live read,
 *  cache hit or miss, so a lock or a redirect from a second ago is never
 *  hidden behind a stale cache entry. */
async function attachLiveFields(data: SerializedPost[]): Promise<SerializedPost[]> {
  if (data.length === 0) return []

  const [locksByPost, redirectTargetsBySlug] = await Promise.all([
    getActiveLocksByPostIds(data.map((row) => row.id)),
    getRedirectTargetsBySlugs(data.map((row) => row.slug)),
  ])

  return data.map((row) => ({
    ...row,
    lockedBy: locksByPost.get(row.id)?.lockedBy ?? null,
    lockedAt: locksByPost.get(row.id)?.lockedAt ?? null,
    redirectTo: redirectTargetsBySlug.get(row.slug) ?? null,
  }))
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { id } = await params

  await publishDueScheduledPosts()

  const post = await db.query.blogPosts.findFirst({ where: eq(blogPosts.id, id) })
  if (!post) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  const cached = await CacheService.remember(`blog-posts:detail:${id}`, ADMIN_CACHE_TTL_SECONDS, () =>
    serializePosts([post])
  )
  const [data] = await attachLiveFields(cached)

  return NextResponse.json({ data, message: "OK" })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  const body = await request.json()
  const parsed = updateBlogPostSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const existing = await db.query.blogPosts.findFirst({ where: eq(blogPosts.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  // Two separate refusals, with two separate status codes, because they are two
  // different problems: 403 means "not your post", 422 means "your post, but
  // that particular change isn't yours to make". Collapsing them would tell a
  // contributor to stop editing when the fix is to stop ticking Publish.
  const role = resolveRole(session.user.role)
  if (!canEditPost(role, session.user.id, existing)) {
    return NextResponse.json(
      { message: "You can only edit your own unpublished posts" },
      { status: 403 }
    )
  }
  if (parsed.data.isPublished === true && !canPublish(role)) {
    return NextResponse.json(
      {
        message: [
          "Your role can't publish posts. Use Submit for review instead — an editor can publish it for you.",
        ],
      },
      { status: 422 }
    )
  }

  // Blocks the lock holder's own edits not at all, and blocks everyone
  // else's — including a bare publish/unpublish toggle sent from the list,
  // which is also a PATCH. This is what actually prevents the silent
  // overwrite; the edit page's lock banner is the friendly warning in front
  // of it, not a substitute for it.
  const blockingLock = await getBlockingLock(id, session.user.id)
  if (blockingLock) {
    return NextResponse.json({ message: [lockConflictMessage(blockingLock)] }, { status: 409 })
  }

  if (parsed.data.slug && parsed.data.slug !== existing.slug) {
    const slugTaken = await db.query.blogPosts.findFirst({ where: eq(blogPosts.slug, parsed.data.slug) })
    if (slugTaken) {
      return NextResponse.json({ message: ["This slug is already in use"] }, { status: 422 })
    }
  }

  // An inactive author stays valid on posts that already credit them — only
  // reassignment to one is blocked.
  if (parsed.data.authorProfileId) {
    const author = await db.query.authors.findFirst({
      where: eq(authors.id, parsed.data.authorProfileId),
    })
    if (!author) {
      return NextResponse.json({ message: ["The selected author does not exist"] }, { status: 422 })
    }
    if (!author.isActive && parsed.data.authorProfileId !== existing.authorProfileId) {
      return NextResponse.json(
        { message: ["The selected author is inactive and can't be assigned to new posts"] },
        { status: 422 }
      )
    }
  }

  let uniqueCategoryIds: string[] | undefined
  if (parsed.data.categoryIds !== undefined) {
    uniqueCategoryIds = Array.from(new Set(parsed.data.categoryIds))
    if (uniqueCategoryIds.length > 0) {
      const foundCategories = await db.query.blogCategories.findMany({ where: inArray(blogCategories.id, uniqueCategoryIds) })
      if (foundCategories.length !== uniqueCategoryIds.length) {
        return NextResponse.json({ message: ["One or more selected categories do not exist"] }, { status: 422 })
      }
    }
  }

  let uniqueTagIds: string[] | undefined
  if (parsed.data.tagIds !== undefined) {
    uniqueTagIds = Array.from(new Set(parsed.data.tagIds))
    if (uniqueTagIds.length > 0) {
      const foundTags = await db.query.blogTags.findMany({ where: inArray(blogTags.id, uniqueTagIds) })
      if (foundTags.length !== uniqueTagIds.length) {
        return NextResponse.json({ message: ["One or more selected tags do not exist"] }, { status: 422 })
      }
    }
  }

  if (parsed.data.seriesId) {
    const series = await db.query.blogSeries.findFirst({ where: eq(blogSeries.id, parsed.data.seriesId) })
    if (!series) {
      return NextResponse.json({ message: ["The selected series does not exist"] }, { status: 422 })
    }
  }

  // The categories the post will have once this PATCH lands — the new set if it
  // sent one, otherwise whatever it already has. Both the primary-category
  // check below and the analyser input need this, and computing it twice is how
  // the two end up disagreeing.
  const existingCategoryLinks = await db.query.blogPostCategories.findMany({
    where: eq(blogPostCategories.postId, id),
  })
  const effectiveCategoryIds = uniqueCategoryIds ?? existingCategoryLinks.map((link) => link.categoryId)

  // The Zod refinement only fires when categoryIds and primaryCategoryId arrive
  // together. A PATCH that sends only the primary still has to be checked
  // against what the post actually belongs to.
  if (parsed.data.primaryCategoryId && !effectiveCategoryIds.includes(parsed.data.primaryCategoryId)) {
    return NextResponse.json(
      { message: ["The primary category must be one of the post's categories"] },
      { status: 422 }
    )
  }

  const updates: Partial<typeof blogPosts.$inferInsert> = { updatedAt: new Date() }
  if (parsed.data.title !== undefined) updates.title = parsed.data.title
  if (parsed.data.slug !== undefined) updates.slug = parsed.data.slug
  if (parsed.data.excerpt !== undefined) updates.excerpt = parsed.data.excerpt
  if (parsed.data.content !== undefined) updates.content = sanitizePostContent(parsed.data.content)
  if (parsed.data.featuredImageKey !== undefined) updates.featuredImageKey = parsed.data.featuredImageKey
  if (parsed.data.featuredImageAltText !== undefined) updates.featuredImageAltText = parsed.data.featuredImageAltText || null
  if (parsed.data.metaTitle !== undefined) updates.metaTitle = parsed.data.metaTitle || null
  if (parsed.data.metaDescription !== undefined) updates.metaDescription = parsed.data.metaDescription || null
  if (parsed.data.canonicalUrl !== undefined) updates.canonicalUrl = parsed.data.canonicalUrl || null
  if (parsed.data.ogImageKey !== undefined) updates.ogImageKey = parsed.data.ogImageKey || null
  if (parsed.data.isIndexable !== undefined) updates.isIndexable = parsed.data.isIndexable
  if (parsed.data.authorProfileId !== undefined) updates.authorProfileId = parsed.data.authorProfileId || null

  if (parsed.data.focusKeyword !== undefined) updates.focusKeyword = parsed.data.focusKeyword || null
  if (parsed.data.secondaryKeywords !== undefined) {
    updates.secondaryKeywords = JSON.stringify(parsed.data.secondaryKeywords)
  }
  if (parsed.data.isCornerstone !== undefined) updates.isCornerstone = parsed.data.isCornerstone
  if (parsed.data.schemaType !== undefined) updates.schemaType = parsed.data.schemaType
  if (parsed.data.schemaData !== undefined) updates.schemaData = JSON.stringify(parsed.data.schemaData)
  if (parsed.data.speakableSelectors !== undefined) {
    updates.speakableSelectors = JSON.stringify(parsed.data.speakableSelectors)
  }

  // Clearing a relation needs a signal distinct from "absent", because absent
  // means "leave unchanged" on a PATCH. The flags win over any id sent
  // alongside them: an explicit clear is never ambiguous.
  if (parsed.data.clearSeries) {
    updates.seriesId = null
    updates.seriesPosition = null
  } else {
    if (parsed.data.seriesId !== undefined) updates.seriesId = parsed.data.seriesId || null
    if (parsed.data.seriesPosition !== undefined) updates.seriesPosition = parsed.data.seriesPosition ?? null
  }

  if (parsed.data.clearPrimaryCategory) {
    updates.primaryCategoryId = null
  } else if (parsed.data.primaryCategoryId !== undefined) {
    updates.primaryCategoryId = parsed.data.primaryCategoryId || null
  }

  // Primary-category integrity. If this PATCH drops the category that is
  // currently primary, the primary has to go with it — a dangling
  // primaryCategoryId is how the breadcrumb silently starts pointing at a
  // category the post is not in, and `set null` on the FK only covers the
  // category being deleted outright, not being unlinked from this post.
  const nextPrimaryCategoryId =
    updates.primaryCategoryId !== undefined ? updates.primaryCategoryId : existing.primaryCategoryId
  if (nextPrimaryCategoryId && !effectiveCategoryIds.includes(nextPrimaryCategoryId)) {
    updates.primaryCategoryId = null
  }

  // The one honest freshness signal. Set ONLY on an explicit "this is a
  // substantive update" — never derived from updatedAt, which bumps on a typo
  // fix. `dateModified`, the sitemap's lastModified, and the public "Last
  // updated" line all read this, and re-dating unchanged content is exactly the
  // pattern Google treats as manipulative.
  //
  // `isSubstantiveUpdate` is a transport flag, not a column: it is read here and
  // never reaches the DB write.
  if (parsed.data.isSubstantiveUpdate) updates.contentUpdatedAt = new Date()

  if (parsed.data.scheduledPublishAt !== undefined || parsed.data.isPublished !== undefined) {
    const now = new Date()
    const requestedDate = parsed.data.scheduledPublishAt ? new Date(parsed.data.scheduledPublishAt) : null
    const nextIsPublished = parsed.data.isPublished ?? existing.isPublished

    if (nextIsPublished) {
      if (requestedDate && requestedDate > now) {
        // Requested published, but for a future date — schedule it instead
        // (publishDueScheduledPosts flips it live once the date arrives).
        updates.isPublished = false
        updates.scheduledPublishAt = requestedDate
      } else {
        updates.isPublished = true
        updates.scheduledPublishAt = null
        if (!existing.publishedAt) updates.publishedAt = requestedDate ?? now
      }
    } else {
      // Explicitly unpublished/drafted — clear any pending schedule so it
      // can't silently auto-publish itself later.
      updates.isPublished = false
      updates.scheduledPublishAt = requestedDate && requestedDate > now ? requestedDate : null
    }
  }

  // A slug change on a post that has ever been live orphans every inbound
  // link, so record a 301 before the old path stops resolving. Only for posts
  // with a publishedAt — a draft's slug was never public, so redirecting it
  // would just be noise.
  const isSlugChanging = parsed.data.slug !== undefined && parsed.data.slug !== existing.slug
  const shouldRecordRedirect = isSlugChanging && existing.publishedAt !== null

  // Recomputed only when the body actually changed. The stored scores exist so
  // the posts list and the audit dashboard can sort without re-parsing every
  // post's HTML per request; re-running the analyser on a bare publish toggle
  // would be three passes over 50k characters to arrive at the same numbers.
  const isContentChanging = updates.content !== undefined && updates.content !== existing.content
  if (isContentChanging) {
    const content = updates.content as string
    const [categoryRows, tagRows, faqRows, baseUrl] = await Promise.all([
      effectiveCategoryIds.length > 0
        ? db.query.blogCategories.findMany({ where: inArray(blogCategories.id, effectiveCategoryIds) })
        : Promise.resolve([]),
      db.query.blogPostTags.findMany({ where: eq(blogPostTags.postId, id) }),
      db.query.blogPostFaqs.findMany({ where: eq(blogPostFaqs.postId, id) }),
      getBaseUrl(),
    ])
    const effectiveTagIds = uniqueTagIds ?? tagRows.map((link) => link.tagId)
    const tagNames = effectiveTagIds.length > 0
      ? (await db.query.blogTags.findMany({ where: inArray(blogTags.id, effectiveTagIds) })).map((t) => t.name)
      : []

    // Every field is read post-merge — scoring the request body alone would
    // grade a one-field PATCH against blanks for everything it left unchanged.
    const seo = analyseSeo({
      title: updates.title ?? existing.title,
      slug: updates.slug ?? existing.slug,
      excerpt: updates.excerpt ?? existing.excerpt,
      metaTitle: updates.metaTitle !== undefined ? updates.metaTitle : existing.metaTitle,
      metaDescription:
        updates.metaDescription !== undefined ? updates.metaDescription : existing.metaDescription,
      content,
      focusKeyword: updates.focusKeyword !== undefined ? updates.focusKeyword : existing.focusKeyword,
      secondaryKeywords: parseStringArray(
        updates.secondaryKeywords !== undefined ? updates.secondaryKeywords : existing.secondaryKeywords
      ),
      featuredImageAltText:
        updates.featuredImageAltText !== undefined
          ? updates.featuredImageAltText
          : existing.featuredImageAltText,
      categoryNames: categoryRows.map((category) => category.name),
      tagNames,
      faqCount: faqRows.length,
      isIndexable: updates.isIndexable ?? existing.isIndexable,
      baseUrl,
    })

    updates.wordCount = countWords(content)
    updates.seoScore = seo.score
    updates.readabilityScore = analyseReadability(content).score
  }

  // Only body edits are worth a revision. A publish toggle or an isIndexable
  // flip would otherwise bury the real edits under near-identical snapshots
  // and push them past the retention cap.
  const isBodyEdit =
    (parsed.data.title !== undefined && parsed.data.title !== existing.title) ||
    (parsed.data.excerpt !== undefined && parsed.data.excerpt !== existing.excerpt) ||
    (updates.content !== undefined && updates.content !== existing.content)

  const updated = await db.transaction(async (tx) => {
    if (isBodyEdit) {
      // Snapshot the PRE-edit state, so restoring this revision undoes the
      // save that created it.
      await tx.insert(blogPostRevisions).values({
        postId: id,
        title: existing.title,
        excerpt: existing.excerpt,
        content: existing.content,
        editorId: session.user!.id!,
      })

      // Prune to the retention cap in the same transaction — content is up to
      // 50k chars, so unbounded history would dominate the database.
      const kept = await tx.query.blogPostRevisions.findMany({
        where: eq(blogPostRevisions.postId, id),
        orderBy: desc(blogPostRevisions.createdAt),
      })
      const excess = kept.slice(REVISION_RETENTION)
      if (excess.length > 0) {
        await tx.delete(blogPostRevisions).where(
          inArray(blogPostRevisions.id, excess.map((r) => r.id))
        )
      }
    }

    const row = await updateReturning(blogPosts, updates, eq(blogPosts.id, id))

    if (shouldRecordRedirect) {
      await upsertRedirectWithFlattening(tx, `/blog/${existing.slug}`, `/blog/${parsed.data.slug}`, true)
    }

    if (uniqueCategoryIds !== undefined) {
      await tx.delete(blogPostCategories).where(eq(blogPostCategories.postId, id))
      if (uniqueCategoryIds.length > 0) {
        await tx.insert(blogPostCategories).values(
          uniqueCategoryIds.map((categoryId) => ({ postId: id, categoryId }))
        )
      }
    }

    if (uniqueTagIds !== undefined) {
      await tx.delete(blogPostTags).where(eq(blogPostTags.postId, id))
      if (uniqueTagIds.length > 0) {
        await tx.insert(blogPostTags).values(
          uniqueTagIds.map((tagId) => ({ postId: id, tagId }))
        )
      }
    }

    return row
  })

  // Cheaper to clear the whole namespace than work out which cached list
  // filters this update could have affected (title changed the search
  // match, category/tag changed which filtered lists include it, ...).
  await CacheService.delPattern("blog-posts:*")

  // Three cases fire a hook, and nothing else does:
  //  - the post just went live, or a live post was pulled down (this is also
  //    the bare publish toggle from the list, which arrives as a PATCH);
  //  - a live post got an explicit substantive update, which is the only kind
  //    of edit worth re-submitting;
  //  - a live post was renamed, so the old URL needs re-crawling for its 301.
  // An ordinary save on a live post does not, and must not: submitting a typo
  // fix is how you get rate-limited for the changes that matter.
  const wentLive = !existing.isPublished && updated.isPublished
  const wentDown = existing.isPublished && !updated.isPublished
  const staysLive = existing.isPublished && updated.isPublished
  if (wentLive || (staysLive && (parsed.data.isSubstantiveUpdate || isSlugChanging))) {
    await onPostPublished({
      ...(await collectHookTaxonomy(id, updated.authorProfileId)),
      id: updated.id,
      slug: updated.slug,
      previousSlug: isSlugChanging ? existing.slug : null,
    })
  } else if (wentDown) {
    await onPostUnpublished({
      ...(await collectHookTaxonomy(id, updated.authorProfileId)),
      id: updated.id,
      slug: updated.slug,
    })
  }

  // A publish-state change gets its own action rather than being folded into
  // "updated": "who put this live" is the question this log is opened to
  // answer, and it has to be reachable by a filter, not by reading summaries.
  const scheduleChanged =
    (updated.scheduledPublishAt?.getTime() ?? null) !== (existing.scheduledPublishAt?.getTime() ?? null)
  const action = wentLive
    ? "published"
    : wentDown
      ? "unpublished"
      : updated.scheduledPublishAt && scheduleChanged
        ? "scheduled"
        : "updated"

  // Relations live in join tables, so they are absent from `updates` and have
  // to be named by hand — otherwise a save that only re-categorised the post
  // would report no changes at all.
  const changed = changedFieldLabels(existing, updates, POST_FIELD_LABELS)
  if (uniqueCategoryIds !== undefined) changed.push("categories")
  if (uniqueTagIds !== undefined) changed.push("tags")

  const summaryParts: string[] = []
  if (isSlugChanging) summaryParts.push(`Slug /${existing.slug} → /${updated.slug}`)
  if (action === "scheduled" && updated.scheduledPublishAt) {
    summaryParts.push(`Scheduled for ${updated.scheduledPublishAt.toISOString()}`)
  }
  if (changed.length > 0 || action === "updated") summaryParts.push(summariseChanges(changed))

  await recordActivity({
    actor: session.user,
    action,
    entityType: "post",
    entityId: updated.id,
    entityLabel: updated.title,
    summary: summaryParts.join(" · ") || null,
    metadata: changed.length > 0 ? { changed } : null,
  })

  const [data] = await attachLiveFields(await serializePosts([updated]))

  return NextResponse.json({ data, message: "Blog post updated" })
}

/**
 * Trashes a post by default; `?permanent=true` destroys it.
 *
 * The two are separate on purpose. A hard delete cascades to the post's FAQs,
 * category and tag links, and revision history, and nothing brings any of it
 * back — that must never be one confirm click away. Trashing hides the post
 * from the admin list and the public site while leaving every row intact.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  const isPermanent = new URL(request.url).searchParams.get("permanent") === "true"

  const existing = await db.query.blogPosts.findFirst({ where: eq(blogPosts.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  const role = resolveRole(session.user.role)
  if (!canTrashPost(role, session.user.id, existing)) {
    return NextResponse.json(
      { message: "You can only delete your own unpublished posts" },
      { status: 403 }
    )
  }
  // Permanent deletion cascades to FAQs, revisions, questions and taxonomy
  // links with nothing to restore from, so it stops at editor regardless of who
  // wrote the post.
  if (isPermanent && !canPermanentlyDeletePost(role)) {
    return NextResponse.json(
      { message: "Your role can't permanently delete posts" },
      { status: 403 }
    )
  }

  const blockingLock = await getBlockingLock(id, session.user.id)
  if (blockingLock) {
    return NextResponse.json({ message: [lockConflictMessage(blockingLock)] }, { status: 409 })
  }

  if (isPermanent) {
    // Guard the destructive path: a post has to be trashed first, so
    // permanent deletion is always a deliberate second decision.
    if (!existing.deletedAt) {
      return NextResponse.json(
        { message: ["Move this post to the trash before deleting it permanently"] },
        { status: 422 }
      )
    }
    await db.delete(blogPosts).where(eq(blogPosts.id, id))
    await CacheService.delPattern("blog-posts:*")

    // The entry outlives the post — which is the whole reason `entityId` is a
    // plain column and not a foreign key. This is the single most valuable row
    // in the table: nothing else records that the content ever existed.
    await recordActivity({
      actor: session.user,
      action: "deleted",
      entityType: "post",
      entityId: id,
      entityLabel: existing.title,
      summary: `Permanently deleted /blog/${existing.slug}, with its FAQs, revisions, and taxonomy links`,
    })

    return NextResponse.json({ data: null, message: "Blog post permanently deleted" })
  }

  if (existing.deletedAt) {
    return NextResponse.json({ message: ["This post is already in the trash"] }, { status: 422 })
  }

  // Unpublish on trash so a trashed post can't stay live on the public site,
  // but keep publishedAt — restoring should not lose the original date.
  await db
    .update(blogPosts)
    .set({ deletedAt: new Date(), isPublished: false, scheduledPublishAt: null, updatedAt: new Date() })
    .where(eq(blogPosts.id, id))

  await CacheService.delPattern("blog-posts:*")

  await recordActivity({
    actor: session.user,
    action: "trashed",
    entityType: "post",
    entityId: id,
    entityLabel: existing.title,
    // Worth stating: trashing silently unpublishes, and someone reading the log
    // later needs to know the post came off the site at this moment.
    summary: existing.isPublished
      ? `Moved to trash and unpublished from /blog/${existing.slug}`
      : "Moved to trash",
  })

  // Trashing a live post takes a real URL off the site. Telling the engines
  // now is the difference between the result disappearing and it sitting in the
  // index pointing at a 404 until the next crawl.
  if (existing.isPublished) {
    await onPostUnpublished({
      ...(await collectHookTaxonomy(id, existing.authorProfileId)),
      id: existing.id,
      slug: existing.slug,
    })
  }

  return NextResponse.json({ data: null, message: "Blog post moved to trash" })
}

/** Restore from the trash. Comes back as a draft — silently re-publishing to
 *  the live site is not something a restore should decide on its own. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  const existing = await db.query.blogPosts.findFirst({ where: eq(blogPosts.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }
  if (!existing.deletedAt) {
    return NextResponse.json({ message: ["This post is not in the trash"] }, { status: 422 })
  }

  // A restore returns the post as a draft, so it is an edit, not a publish —
  // the same rule that governs PATCH applies.
  if (!canEditPost(resolveRole(session.user.role), session.user.id, { authorId: existing.authorId })) {
    return NextResponse.json(
      { message: "You can only restore your own posts" },
      { status: 403 }
    )
  }

  const blockingLock = await getBlockingLock(id, session.user.id)
  if (blockingLock) {
    return NextResponse.json({ message: [lockConflictMessage(blockingLock)] }, { status: 409 })
  }

  const restored = await updateReturning(blogPosts, { deletedAt: null, updatedAt: new Date() }, eq(blogPosts.id, id))

  await CacheService.delPattern("blog-posts:*")

  await recordActivity({
    actor: session.user,
    action: "restored",
    entityType: "post",
    entityId: restored.id,
    entityLabel: restored.title,
    summary: "Restored from the trash as a draft",
  })

  const [data] = await attachLiveFields(await serializePosts([restored]))

  return NextResponse.json({ data, message: "Blog post restored" })
}
