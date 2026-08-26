import { and, eq, isNotNull, isNull, lte } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPosts } from "@/db/tables"

/** Lazily flips due scheduled posts to published — called before every read
 *  since this app has no cron/job infra. Not exact-to-the-second, but a post
 *  goes live the next time anyone loads the admin list or the post itself. */
export async function publishDueScheduledPosts(): Promise<void> {
  const now = new Date()
  const due = await db.query.blogPosts.findMany({
    // isNull(deletedAt): trashing already clears scheduledPublishAt, but a
    // trashed post must never be able to publish itself back onto the live
    // site if anything else ever sets that date.
    where: and(
      eq(blogPosts.isPublished, false),
      isNull(blogPosts.deletedAt),
      isNotNull(blogPosts.scheduledPublishAt),
      lte(blogPosts.scheduledPublishAt, now)
    ),
  })
  if (due.length === 0) return

  await Promise.all(
    due.map((post) =>
      db.update(blogPosts)
        .set({ isPublished: true, publishedAt: post.publishedAt ?? post.scheduledPublishAt, updatedAt: now })
        .where(eq(blogPosts.id, post.id))
    )
  )
}
