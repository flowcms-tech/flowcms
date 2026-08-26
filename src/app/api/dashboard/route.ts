import { NextRequest, NextResponse } from "next/server"
import { and, asc, desc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPostQuestions, blogPosts, users } from "@/db/tables"
import { publishDueScheduledPosts } from "@/db/blogPostScheduling"
import { listActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * Everything the dashboard shows, in one request.
 *
 * One endpoint rather than six, because the dashboard is the first screen after
 * sign-in and six round trips is what makes a landing page feel slow. Nothing
 * here is cached: the numbers are the reason someone is looking, and a count of
 * drafts that is a minute stale is a count nobody trusts.
 */

/** A published post nobody has touched in this long is the refresh candidate
 *  the "needs attention" tile is pointing at. Twelve months is the round number
 *  the content-decay literature settles on; it is not a hard rule. */
const STALE_AFTER_DAYS = 365

/** Below this, the stored score is low enough to be worth a second look. Same
 *  threshold the SEO audit screen treats as failing. */
const LOW_SEO_SCORE = 60

const LIST_LIMIT = 5

async function countPosts(where: ReturnType<typeof and>): Promise<number> {
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(blogPosts).where(where)
  return Number(total)
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  // Same reason every other blog read does this: there is no cron, so a post
  // whose time has come only goes live on the next read. Counting it as
  // "scheduled" on the very screen that would tell someone to go publish it is
  // the one wrong answer here.
  await publishDueScheduledPosts()

  const active = isNull(blogPosts.deletedAt)
  const staleCutoff = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000)

  const [
    published,
    drafts,
    scheduledCount,
    pendingReview,
    trashed,
    questionsPending,
    missingMetaDescription,
    lowSeoScore,
    stale,
    scheduled,
    awaitingReview,
    recentlyPublished,
    activity,
  ] = await Promise.all([
    countPosts(and(active, eq(blogPosts.isPublished, true))),
    // A draft is unpublished AND unscheduled — a scheduled post is counted in
    // its own tile, and counting it in both makes the two tiles add up to more
    // posts than exist.
    countPosts(and(active, eq(blogPosts.isPublished, false), isNull(blogPosts.scheduledPublishAt))),
    countPosts(and(active, eq(blogPosts.isPublished, false), isNotNull(blogPosts.scheduledPublishAt))),
    countPosts(and(active, eq(blogPosts.reviewStatus, "pending"))),
    countPosts(isNotNull(blogPosts.deletedAt)),
    db
      .select({ total: sql<number>`count(*)` })
      .from(blogPostQuestions)
      .where(eq(blogPostQuestions.status, "pending"))
      .then(([row]) => Number(row.total)),

    // The three health numbers are counted over *published* posts only. A draft
    // with no meta description is a post someone is still writing, not a
    // problem on the live site.
    countPosts(
      and(
        active,
        eq(blogPosts.isPublished, true),
        or(isNull(blogPosts.metaDescription), eq(blogPosts.metaDescription, ""))
      )
    ),
    countPosts(and(active, eq(blogPosts.isPublished, true), lt(blogPosts.seoScore, LOW_SEO_SCORE))),
    countPosts(
      and(
        active,
        eq(blogPosts.isPublished, true),
        // contentUpdatedAt ?? publishedAt — the same honest freshness signal the
        // public "Last updated" line and the sitemap use. Row updatedAt would
        // count a typo fix as a refresh.
        lt(sql`coalesce(${blogPosts.contentUpdatedAt}, ${blogPosts.publishedAt})`, staleCutoff)
      )
    ),

    db
      .select({
        id: blogPosts.id,
        title: blogPosts.title,
        scheduledPublishAt: blogPosts.scheduledPublishAt,
      })
      .from(blogPosts)
      .where(and(active, eq(blogPosts.isPublished, false), isNotNull(blogPosts.scheduledPublishAt)))
      .orderBy(asc(blogPosts.scheduledPublishAt))
      .limit(LIST_LIMIT),

    db
      .select({
        id: blogPosts.id,
        title: blogPosts.title,
        updatedAt: blogPosts.updatedAt,
        authorName: users.name,
      })
      .from(blogPosts)
      .leftJoin(users, eq(users.id, blogPosts.authorId))
      .where(and(active, eq(blogPosts.reviewStatus, "pending")))
      .orderBy(asc(blogPosts.updatedAt))
      .limit(LIST_LIMIT),

    db
      .select({ id: blogPosts.id, title: blogPosts.title, publishedAt: blogPosts.publishedAt })
      .from(blogPosts)
      .where(and(active, eq(blogPosts.isPublished, true)))
      .orderBy(desc(blogPosts.publishedAt))
      .limit(LIST_LIMIT),

    listActivity({ perPage: 6 }),
  ])

  return NextResponse.json({
    data: {
      counts: {
        published,
        drafts,
        scheduled: scheduledCount,
        pendingReview,
        trashed,
        questionsPending,
      },
      health: { missingMetaDescription, lowSeoScore, stale },
      scheduled,
      awaitingReview,
      recentlyPublished,
      // The same rows the activity log screen renders, capped at six — the
      // widget is a "what just happened" glance, and the full history is one
      // click away rather than duplicated here.
      recentActivity: activity.rows.map((row) => ({
        id: row.id,
        actorName: row.actorName,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        entityLabel: row.entityLabel,
        summary: row.summary,
        createdAt: row.createdAt,
      })),
    },
    message: "OK",
  })
}
