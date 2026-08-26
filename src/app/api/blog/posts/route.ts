import { NextRequest, NextResponse } from "next/server"
import { desc, eq, inArray, isNull, isNotNull } from "drizzle-orm"
import { db } from "@/db/client"
import { authors, blogCategories, blogPostCategories, blogPosts, blogPostTags, blogSeries, blogTags, users } from "@/db/tables"
import { StorageService } from "@/Framework/Storage/StorageService"
import { createBlogPostSchema } from "@/Modules/Blog/Posts/Values/Validations"
import { publishDueScheduledPosts } from "@/db/blogPostScheduling"
import { sanitizePostContent } from "@/Framework/Functions/sanitizePostContent"
import { getActiveLocksByPostIds } from "@/db/postLocks"
import { getRedirectTargetsBySlugs } from "@/db/redirectMaintenance"
import { CacheService, ADMIN_CACHE_TTL_SECONDS } from "@/Framework/Redis/CacheService"
import { countWords } from "@/Modules/Blog/Posts/Values/contentStats"
import { analyseSeo } from "@/Modules/Blog/Posts/Values/seoAnalysis"
import { analyseReadability } from "@/Modules/Blog/Posts/Values/readability"
import { getBaseUrl } from "@/Framework/Settings/SettingsService"
import { onPostPublished } from "@/Modules/Blog/Posts/Services/PublishHooks"
import { canPublish, resolveRole } from "@/Framework/Auth/permissions"
import { REVIEW_STATUSES, type ReviewStatus } from "@/Modules/Blog/Posts/Values/reviewWorkflow"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { insertReturning } from "@/db/writes"

const IMAGE_URL_TTL_SECONDS = 3600

type PostRow = typeof blogPosts.$inferSelect

/**
 * Reads one of the JSON-array columns (`secondaryKeywords`,
 * `speakableSelectors`) back into an array.
 *
 * Never throws, and never propagates a bad row. A single post whose column was
 * hand-edited, half-written, or migrated from an older shape would otherwise
 * 500 the whole list endpoint — taking down the admin screen that is the only
 * place to fix it from. An empty array is a survivable lie; a blank page is
 * not.
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

/** Bare entity ids serializePosts's output carries, enough for
 *  attachLiveFields to key its lookups off — whether that output came
 *  straight from the database or out of the cache. */
type SerializedPost = Awaited<ReturnType<typeof serializePosts>>[number]

/**
 * Deliberately does not include lockedBy/lockedAt/redirectTo — this is the
 * function whose output gets cached (see GET below), and both of those are
 * exactly the fields that must never be stale: a lock is meant to reflect
 * "right now," and caching it for even 60s would quietly undermine the
 * whole point of post locking (see src/db/postLocks.ts). They're fetched
 * fresh on every request instead, cache hit or miss, by attachLiveFields.
 */
async function serializePosts(rows: PostRow[]) {
  if (rows.length === 0) return []

  const postIds = rows.map((row) => row.id)
  // Reviewers are pulled in the same query as creators — the approving editor
  // is usually a different account, and a second round trip for one name would
  // be the only extra query the editorial columns cost.
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
        // schemaType and only `parseSchemaData` knows the mapping. Parsing it
        // here would mean duplicating that switch in two route files.
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

/** Merges in the two fields serializePosts leaves out — always a live read,
 *  cache hit or miss, so a lock or a redirect created a second ago is never
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

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)
  const search = searchParams.get("search")?.trim().toLowerCase() || undefined
  // The trash is a separate view, never mixed into the main list.
  const showTrashed = searchParams.get("trashed") === "true"
  // Backs the editor's pending-review queue. Filtered here rather than in the
  // client so the queue does not have to download every post to find the four
  // that are waiting.
  const reviewStatusParam = searchParams.get("reviewStatus")?.trim() || undefined
  const reviewStatus = REVIEW_STATUSES.includes(reviewStatusParam as ReviewStatus)
    ? (reviewStatusParam as ReviewStatus)
    : undefined

  await publishDueScheduledPosts()

  const rows = await db.query.blogPosts.findMany({
    where: showTrashed ? isNotNull(blogPosts.deletedAt) : isNull(blogPosts.deletedAt),
    orderBy: showTrashed ? desc(blogPosts.deletedAt) : desc(blogPosts.createdAt),
  })

  const searched = search
    ? rows.filter((row) => row.title.toLowerCase().includes(search))
    : rows
  const filtered = reviewStatus
    ? searched.filter((row) => row.reviewStatus === reviewStatus)
    : searched

  // Cached by exactly the inputs that change the result set. A write to any
  // post clears every variant of this in one delPattern call (see POST
  // below) rather than tracking each search/trashed combination.
  const cacheKey = `blog-posts:list:${showTrashed ? "trashed" : "active"}:${search ?? "_"}:${reviewStatus ?? "_"}`
  const cached = await CacheService.remember(cacheKey, ADMIN_CACHE_TTL_SECONDS, () =>
    serializePosts(filtered)
  )
  const data = await attachLiveFields(cached)

  return NextResponse.json({ data, message: "OK" })
}

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const body = await request.json()
  const parsed = createBlogPostSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  // Role enforcement lives here, not in the form that hides the Publish button.
  // A contributor with the browser console open sends the same JSON as anyone
  // else, so the refusal has to happen where the write does.
  const role = resolveRole(session.user.role)
  if (parsed.data.isPublished && !canPublish(role)) {
    return NextResponse.json(
      {
        message: [
          "Your role can't publish posts. Save it as a draft and use Submit for review — an editor can publish it for you.",
        ],
      },
      { status: 422 }
    )
  }

  const existingSlug = await db.query.blogPosts.findFirst({
    where: eq(blogPosts.slug, parsed.data.slug),
  })
  if (existingSlug) {
    return NextResponse.json({ message: ["This slug is already in use"] }, { status: 422 })
  }

  const uniqueCategoryIds = Array.from(new Set(parsed.data.categoryIds))
  const foundCategories = await db.query.blogCategories.findMany({ where: inArray(blogCategories.id, uniqueCategoryIds) })
  if (foundCategories.length !== uniqueCategoryIds.length) {
    return NextResponse.json({ message: ["One or more selected categories do not exist"] }, { status: 422 })
  }

  if (parsed.data.authorProfileId) {
    const author = await db.query.authors.findFirst({
      where: eq(authors.id, parsed.data.authorProfileId),
    })
    if (!author) {
      return NextResponse.json({ message: ["The selected author does not exist"] }, { status: 422 })
    }
    if (!author.isActive) {
      return NextResponse.json(
        { message: ["The selected author is inactive and can't be assigned to new posts"] },
        { status: 422 }
      )
    }
  }

  const uniqueTagIds = Array.from(new Set(parsed.data.tagIds))
  let foundTags: (typeof blogTags.$inferSelect)[] = []
  if (uniqueTagIds.length > 0) {
    foundTags = await db.query.blogTags.findMany({ where: inArray(blogTags.id, uniqueTagIds) })
    if (foundTags.length !== uniqueTagIds.length) {
      return NextResponse.json({ message: ["One or more selected tags do not exist"] }, { status: 422 })
    }
  }

  // The Zod refinement only checks that the primary category is one of the
  // selected ones — it cannot know whether the series row exists. Without this
  // the insert fails on the foreign key and the editor gets a 500 for a stale
  // dropdown option.
  if (parsed.data.seriesId) {
    const series = await db.query.blogSeries.findFirst({ where: eq(blogSeries.id, parsed.data.seriesId) })
    if (!series) {
      return NextResponse.json({ message: ["The selected series does not exist"] }, { status: 422 })
    }
  }

  // Computed on write, never on read: counting words means stripping tags, and
  // doing that for every card in every listing on every request is waste. The
  // stored numbers exist so the list and the audit dashboard can sort without
  // parsing HTML — the panel still re-runs the analyser wherever it shows one.
  const sanitizedContent = sanitizePostContent(parsed.data.content)
  const baseUrl = await getBaseUrl()
  const seo = analyseSeo({
    title: parsed.data.title,
    slug: parsed.data.slug,
    excerpt: parsed.data.excerpt,
    metaTitle: parsed.data.metaTitle,
    metaDescription: parsed.data.metaDescription,
    content: sanitizedContent,
    focusKeyword: parsed.data.focusKeyword,
    secondaryKeywords: parsed.data.secondaryKeywords,
    featuredImageAltText: parsed.data.featuredImageAltText,
    categoryNames: foundCategories.map((category) => category.name),
    tagNames: foundTags.map((tag) => tag.name),
    // Left undefined rather than 0: FAQs are attached after the post exists, so
    // scoring a brand-new post for having none would be a warning about a step
    // the editor has not reached yet.
    faqCount: undefined,
    isIndexable: parsed.data.isIndexable ?? true,
    baseUrl,
  })
  const readability = analyseReadability(sanitizedContent)

  // "Publish" only actually publishes now if the requested date is empty or
  // in the past; a future date schedules it instead (see
  // publishDueScheduledPosts for how it later goes live on its own).
  // "Save as Draft" never schedules — any date entered there is ignored.
  const now = new Date()
  const requestedDate = parsed.data.scheduledPublishAt ? new Date(parsed.data.scheduledPublishAt) : null
  const isScheduledForFuture = parsed.data.isPublished && !!requestedDate && requestedDate > now

  const isPublished = parsed.data.isPublished && !isScheduledForFuture
  const publishedAt = isPublished ? (requestedDate ?? now) : null
  const scheduledPublishAt = isScheduledForFuture ? requestedDate : null

  const created = await db.transaction(async (tx) => {
    const post = await insertReturning(blogPosts, {
        title: parsed.data.title,
        slug: parsed.data.slug,
        excerpt: parsed.data.excerpt,
        content: sanitizedContent,
        featuredImageKey: parsed.data.featuredImageKey,
        featuredImageAltText: parsed.data.featuredImageAltText || null,
        authorId: session.user.id,
        authorProfileId: parsed.data.authorProfileId || null,
        isPublished,
        publishedAt,
        scheduledPublishAt,
        metaTitle: parsed.data.metaTitle || null,
        metaDescription: parsed.data.metaDescription || null,
        canonicalUrl: parsed.data.canonicalUrl || null,
        ogImageKey: parsed.data.ogImageKey || null,
        isIndexable: parsed.data.isIndexable ?? true,

        focusKeyword: parsed.data.focusKeyword || null,
        secondaryKeywords: JSON.stringify(parsed.data.secondaryKeywords ?? []),
        seoScore: seo.score,
        readabilityScore: readability.score,
        wordCount: countWords(sanitizedContent),

        primaryCategoryId: parsed.data.primaryCategoryId || null,
        seriesId: parsed.data.seriesId || null,
        seriesPosition: parsed.data.seriesPosition ?? null,
        isCornerstone: parsed.data.isCornerstone ?? false,

        schemaType: parsed.data.schemaType ?? "BlogPosting",
        // Stored as a string because the shape is dictated entirely by
        // schemaType; nothing ever queries inside it. `undefined` payloads for
        // the types that carry none stay null rather than becoming "null".
        schemaData: parsed.data.schemaData === undefined ? null : JSON.stringify(parsed.data.schemaData),
        speakableSelectors: JSON.stringify(parsed.data.speakableSelectors ?? []),

        // contentUpdatedAt is deliberately NOT set on create. It means "the
        // content changed after publication"; on a brand-new post that is
        // publishedAt, and stamping both would make the public "Last updated"
        // line appear on a post nobody has updated.
      })

    await tx.insert(blogPostCategories).values(
      uniqueCategoryIds.map((categoryId) => ({ postId: post.id, categoryId }))
    )

    if (uniqueTagIds.length > 0) {
      await tx.insert(blogPostTags).values(
        uniqueTagIds.map((tagId) => ({ postId: post.id, tagId }))
      )
    }

    return post
  })

  // Every list/detail variant just went stale — a new post can appear in
  // any of them (unfiltered, and any search term that happens to match its
  // title), so the whole namespace is cleared rather than guessing which
  // cached searches it would have matched.
  await CacheService.delPattern("blog-posts:*")

  // One entry, not two. A post created as published is one decision by one
  // person, and splitting it into "created" + "published" would double every
  // row in the log for no extra fact — the publish state is carried in the
  // summary instead. Later transitions get their own entries in PATCH, where
  // they genuinely are separate decisions.
  await recordActivity({
    actor: session.user,
    action: "created",
    entityType: "post",
    entityId: created.id,
    entityLabel: created.title,
    summary: isPublished
      ? "Created and published"
      : scheduledPublishAt
        ? `Created, scheduled for ${scheduledPublishAt.toISOString()}`
        : "Created as a draft",
  })

  // Only when it actually went live. A draft or a future-dated schedule has no
  // public URL yet, and telling IndexNow about one is how you get a soft-404
  // recorded against a page that never existed.
  if (isPublished) {
    const author = created.authorProfileId
      ? await db.query.authors.findFirst({ where: eq(authors.id, created.authorProfileId) })
      : null
    await onPostPublished({
      id: created.id,
      slug: created.slug,
      categorySlugs: foundCategories.map((category) => category.slug),
      tagSlugs: foundTags.map((tag) => tag.slug),
      authorSlug: author?.slug ?? null,
    })
  }

  const [data] = await attachLiveFields(await serializePosts([created]))

  return NextResponse.json({ data, message: "Blog post created" })
}
