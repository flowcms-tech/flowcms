import { NextRequest, NextResponse } from "next/server"
import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db/client"
import { blogCategories, blogPostCategories, blogPosts, blogPostTags, blogSeries, blogTags } from "@/db/tables"
import { getActiveLocksByPostIds } from "@/db/postLocks"
import { CacheService } from "@/Framework/Redis/CacheService"
import { SCHEMA_TYPES } from "@/Modules/Blog/Posts/Values/Validations"
import { canBulkEditPosts, resolveRole } from "@/Framework/Auth/permissions"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * Bulk SEO editing.
 *
 * Fixing 40 missing focus keywords one drawer at a time is why they stay
 * missing. This is the escape hatch — one transaction, per-id results, capped
 * so a runaway selection cannot rewrite the whole blog in a single call.
 */

/** Enough for any realistic screenful of selected rows, small enough that the
 *  whole batch stays one comprehensible transaction. */
const MAX_IDS = 100

/**
 * **`metaTitle` and `metaDescription` are deliberately absent, and this is the
 * enforcement.**
 *
 * Pasting one description onto 40 posts creates exactly the duplicate-content
 * problem the field exists to prevent: Google collapses the duplicates, picks
 * one winner itself, and the other 39 lose the snippet they were written for.
 * The only correct bulk form of those two fields is a *template* applied per
 * post (spec 3.5), which is a different feature with a different route. The
 * schema is strict so an attempt to send them is a 422 that says so, rather
 * than a silent strip that looks like it worked.
 */
const bulkChangesSchema = z
  .strictObject({
    isIndexable: z.boolean().optional(),
    primaryCategoryId: z.string().nullable().optional(),
    addCategoryIds: z.array(z.string()).optional(),
    removeCategoryIds: z.array(z.string()).optional(),
    addTagIds: z.array(z.string()).optional(),
    removeTagIds: z.array(z.string()).optional(),
    focusKeyword: z.string().max(100).nullable().optional(),
    schemaType: z.enum(SCHEMA_TYPES).optional(),
    isCornerstone: z.boolean().optional(),
    seriesId: z.string().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Choose at least one change to apply" })

const bulkUpdateSchema = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1, "Select at least one post")
    .max(MAX_IDS, `Bulk edit is capped at ${MAX_IDS} posts per call`),
  changes: bulkChangesSchema,
})

interface BulkResult {
  id: string
  ok: boolean
  /** Present only on failure, and always says what to do about it — a bulk
   *  action that reports "3 failed" with no reasons is a bulk action nobody
   *  trusts enough to use again. */
  message?: string
}

export async function PATCH(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  // A bulk call names ids the caller mostly does not own, so there is no
  // per-post ownership rule to apply — either the role can edit other people's
  // posts or it cannot use this endpoint at all.
  if (!canBulkEditPosts(resolveRole(session.user.role))) {
    return NextResponse.json(
      { message: "Your role can't bulk-edit posts" },
      { status: 403 }
    )
  }

  const parsed = bulkUpdateSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const ids = Array.from(new Set(parsed.data.ids))
  const changes = parsed.data.changes

  // Referenced rows are checked once for the whole batch rather than per post —
  // a category that does not exist is wrong for all 100 ids, and 100 identical
  // failure lines would bury the ones that are actually per-post.
  const referencedCategoryIds = Array.from(
    new Set([
      ...(changes.addCategoryIds ?? []),
      ...(changes.removeCategoryIds ?? []),
      ...(changes.primaryCategoryId ? [changes.primaryCategoryId] : []),
    ])
  )
  if (referencedCategoryIds.length > 0) {
    const found = await db.query.blogCategories.findMany({
      where: inArray(blogCategories.id, referencedCategoryIds),
    })
    if (found.length !== referencedCategoryIds.length) {
      return NextResponse.json({ message: ["One or more selected categories do not exist"] }, { status: 422 })
    }
  }

  const referencedTagIds = Array.from(
    new Set([...(changes.addTagIds ?? []), ...(changes.removeTagIds ?? [])])
  )
  if (referencedTagIds.length > 0) {
    const found = await db.query.blogTags.findMany({ where: inArray(blogTags.id, referencedTagIds) })
    if (found.length !== referencedTagIds.length) {
      return NextResponse.json({ message: ["One or more selected tags do not exist"] }, { status: 422 })
    }
  }

  if (changes.seriesId) {
    const series = await db.query.blogSeries.findFirst({ where: eq(blogSeries.id, changes.seriesId) })
    if (!series) {
      return NextResponse.json({ message: ["The selected series does not exist"] }, { status: 422 })
    }
  }

  const [posts, locks] = await Promise.all([
    db.query.blogPosts.findMany({ where: inArray(blogPosts.id, ids) }),
    getActiveLocksByPostIds(ids),
  ])
  const postById = new Map(posts.map((post) => [post.id, post]))

  const results: BulkResult[] = []

  // One transaction, but every post is attempted inside its own try/catch.
  // Letting a single bad row abort the batch would roll back the 99 that
  // worked, and the admin would have no way to tell which one was the problem.
  await db.transaction(async (tx) => {
    for (const id of ids) {
      const post = postById.get(id)
      if (!post) {
        results.push({ id, ok: false, message: "Post not found" })
        continue
      }

      // Same guard the single-post PATCH applies, for the same reason: a bulk
      // action is still a write, and silently overwriting an open editor's work
      // because it came through a different screen would be worse, not better.
      const lock = locks.get(id)
      if (lock && lock.lockedBy.id !== session.user!.id) {
        results.push({
          id,
          ok: false,
          message: `Skipped — being edited by ${lock.lockedBy.name || "another admin"}`,
        })
        continue
      }

      try {
        const updates: Partial<typeof blogPosts.$inferInsert> = { updatedAt: new Date() }
        if (changes.isIndexable !== undefined) updates.isIndexable = changes.isIndexable
        if (changes.focusKeyword !== undefined) updates.focusKeyword = changes.focusKeyword || null
        if (changes.schemaType !== undefined) updates.schemaType = changes.schemaType
        if (changes.isCornerstone !== undefined) updates.isCornerstone = changes.isCornerstone
        if (changes.seriesId !== undefined) {
          updates.seriesId = changes.seriesId || null
          // Position is per-series and meaningless against a different one, so a
          // bulk series change always clears it rather than leaving every post
          // in the batch claiming to be part 3.
          if (!changes.seriesId) updates.seriesPosition = null
        }

        // -- Work out the resulting membership BEFORE writing anything ---------
        // Every per-post rejection below has to happen while the post is still
        // untouched. Validating halfway through would leave a "skipped" post
        // carrying the categories the batch had already added to it — a partial
        // write reported as no write at all is the worst of both.
        const [currentCategoryLinks, currentTagLinks] = await Promise.all([
          tx.query.blogPostCategories.findMany({ where: eq(blogPostCategories.postId, id) }),
          tx.query.blogPostTags.findMany({ where: eq(blogPostTags.postId, id) }),
        ])
        const currentCategoryIds = currentCategoryLinks.map((link) => link.categoryId)
        const currentTagIds = currentTagLinks.map((link) => link.tagId)

        const addingCategories = (changes.addCategoryIds ?? []).filter(
          (categoryId) => !currentCategoryIds.includes(categoryId)
        )
        const removingCategories = (changes.removeCategoryIds ?? []).filter((categoryId) =>
          currentCategoryIds.includes(categoryId)
        )
        const nextCategoryIds = [...currentCategoryIds, ...addingCategories].filter(
          (categoryId) => !removingCategories.includes(categoryId)
        )

        // A post with no categories falls out of every archive and has no
        // breadcrumb. Reaching that state through a bulk action nobody
        // double-checked is not a thing this route will do.
        if (currentCategoryIds.length > 0 && nextCategoryIds.length === 0) {
          results.push({
            id,
            ok: false,
            message: "Skipped — this would leave the post with no categories",
          })
          continue
        }

        if (changes.primaryCategoryId && !nextCategoryIds.includes(changes.primaryCategoryId)) {
          results.push({
            id,
            ok: false,
            message: "Skipped — the post is not in the chosen primary category",
          })
          continue
        }
        if (changes.primaryCategoryId !== undefined) {
          updates.primaryCategoryId = changes.primaryCategoryId || null
        }

        // Same integrity rule the single-post PATCH enforces: a primary the post
        // no longer belongs to points the breadcrumb at a category it is not in.
        const nextPrimary =
          updates.primaryCategoryId !== undefined ? updates.primaryCategoryId : post.primaryCategoryId
        if (nextPrimary && !nextCategoryIds.includes(nextPrimary)) updates.primaryCategoryId = null

        // -- Writes ------------------------------------------------------------
        if (addingCategories.length > 0) {
          await tx.insert(blogPostCategories).values(
            addingCategories.map((categoryId) => ({ postId: id, categoryId }))
          )
        }
        if (removingCategories.length > 0) {
          await tx
            .delete(blogPostCategories)
            .where(
              and(
                eq(blogPostCategories.postId, id),
                inArray(blogPostCategories.categoryId, removingCategories)
              )
            )
        }

        const addingTags = (changes.addTagIds ?? []).filter((tagId) => !currentTagIds.includes(tagId))
        const removingTags = (changes.removeTagIds ?? []).filter((tagId) => currentTagIds.includes(tagId))
        if (addingTags.length > 0) {
          await tx.insert(blogPostTags).values(addingTags.map((tagId) => ({ postId: id, tagId })))
        }
        if (removingTags.length > 0) {
          await tx
            .delete(blogPostTags)
            .where(and(eq(blogPostTags.postId, id), inArray(blogPostTags.tagId, removingTags)))
        }

        await tx.update(blogPosts).set(updates).where(eq(blogPosts.id, id))
        results.push({ id, ok: true })
      } catch (error) {
        results.push({
          id,
          ok: false,
          message: error instanceof Error ? error.message : "Update failed",
        })
      }
    }
  })

  await CacheService.delPattern("blog-posts:*")

  const updatedCount = results.filter((result) => result.ok).length
  const failedCount = results.length - updatedCount

  // One entry for the whole batch, not one per post. A hundred identical rows
  // would push every other event off the first page of the log, and the fact
  // worth recording is the batch itself — which posts and which fields are in
  // the metadata for anyone who needs them.
  if (updatedCount > 0) {
    await recordActivity({
      actor: session.user,
      action: "bulk_updated",
      entityType: "post",
      // No entityId: this entry is about a set. Filtering by one post's history
      // deliberately will not surface it — pretending it belongs to whichever
      // id happened to be first would be worse.
      entityId: null,
      entityLabel: `${updatedCount} post${updatedCount === 1 ? "" : "s"}`,
      summary: `Bulk edit: ${Object.keys(changes).join(", ")}${
        failedCount > 0 ? ` · ${failedCount} skipped` : ""
      }`,
      metadata: {
        changes,
        updatedIds: results.filter((result) => result.ok).map((result) => result.id),
        skipped: results.filter((result) => !result.ok),
      },
    })
  }

  // Deliberately no publish hook. Nothing here changes a post's publish state,
  // and firing IndexNow for 100 URLs because someone ticked a cornerstone box
  // is the fastest way to get the whole site rate-limited.
  // `data` is the per-id array itself, not a summary object: the caller renders
  // the failures row by row, and a count it has to trust instead of the rows it
  // can show is what makes a partial failure illegible.
  return NextResponse.json({
    data: results,
    message: failedCount === 0
      ? `${updatedCount} post${updatedCount === 1 ? "" : "s"} updated`
      : `${updatedCount} updated, ${failedCount} skipped`,
  })
}
