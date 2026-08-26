import { NextRequest, NextResponse } from "next/server"
import { desc, eq, like, or } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPosts, redirects } from "@/db/tables"
import { createRedirectSchema } from "@/Modules/Redirects/Values/Validations"
import { upsertRedirectWithFlattening, findLiveConflict } from "@/db/redirectMaintenance"
import { markNotFoundResolved } from "@/db/notFoundLogging"
import { getBlockingLock, lockConflictMessage } from "@/db/postLocks"
import { CacheService, ADMIN_CACHE_TTL_SECONDS } from "@/Framework/Redis/CacheService"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

function serialize(row: typeof redirects.$inferSelect) {
  return {
    id: row.id,
    fromPath: row.fromPath,
    toPath: row.toPath,
    statusCode: row.statusCode,
    isAutomatic: row.isAutomatic,
    createdAt: row.createdAt,
  }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)
  const search = searchParams.get("search")?.trim().toLowerCase()

  const data = await CacheService.remember(`redirects:list:${search ?? "_"}`, ADMIN_CACHE_TTL_SECONDS, async () => {
    const rows = await db.query.redirects.findMany({
      where: search
        ? or(like(redirects.fromPath, `%${search}%`), like(redirects.toPath, `%${search}%`))
        : undefined,
      orderBy: desc(redirects.createdAt),
    })
    return rows.map(serialize)
  })

  return NextResponse.json({ data, message: "OK" })
}

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const parsed = createRedirectSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const { fromPath, toPath, statusCode, alsoTrashSourcePost } = parsed.data

  if (fromPath === toPath) {
    return NextResponse.json({ message: ["A path can't redirect to itself"] }, { status: 422 })
  }

  // The real content always wins over this table (see the not-found
  // branches in src/app/blog/**), so a redirect for a path something still
  // resolves at would silently do nothing. Refuse it unless the request
  // explicitly asks to clear the way.
  const conflict = await findLiveConflict(fromPath)
  if (conflict) {
    if (conflict.type !== "post") {
      return NextResponse.json(
        {
          message: [
            `"${conflict.title}" is still an active ${conflict.type} at that path. Deactivate it first, or this redirect won't take effect.`,
          ],
        },
        { status: 422 }
      )
    }
    if (!alsoTrashSourcePost) {
      return NextResponse.json(
        {
          message: [
            `"${conflict.title}" is still live at that path. Trash it to free up the URL, or check "also move this post to the trash" to do both at once.`,
          ],
        },
        { status: 422 }
      )
    }

    const blockingLock = await getBlockingLock(conflict.id, session.user.id)
    if (blockingLock) {
      return NextResponse.json({ message: [lockConflictMessage(blockingLock)] }, { status: 409 })
    }
  }

  await db.transaction(async (tx) => {
    if (conflict?.type === "post") {
      // Same trash semantics as DELETE /api/blog/posts/[id]: unpublish and
      // hide, keep publishedAt so a future restore doesn't lose the
      // original date, clear any pending schedule so it can't quietly
      // re-publish itself back onto the URL this redirect now owns.
      await tx
        .update(blogPosts)
        .set({ deletedAt: new Date(), isPublished: false, scheduledPublishAt: null, updatedAt: new Date() })
        .where(eq(blogPosts.id, conflict.id))
    }
    // upsertRedirectWithFlattening invalidates redirects:* on its own; the
    // post cache needs its own call here since trashing a post is this
    // route's side effect, not something that function knows about.
    await upsertRedirectWithFlattening(tx, fromPath, toPath, false, statusCode)
  })

  if (conflict?.type === "post") {
    await CacheService.delPattern("blog-posts:*")
  }

  // Creating a redirect is what "fixing" a logged 404 means. The row is
  // marked, never deleted — the question after a fix is "did the hits stop",
  // and a deleted row cannot answer it.
  await markNotFoundResolved(fromPath)
  await CacheService.delPattern("not-found-log:*")

  const created = await db.query.redirects.findFirst({
    where: eq(redirects.fromPath, fromPath),
  })

  await recordActivity({
    actor: session.user,
    action: "created",
    entityType: "redirect",
    entityId: created?.id ?? null,
    entityLabel: fromPath,
    // The trashed post is named here rather than getting an entry of its own:
    // it was one click, and two rows would read as two separate decisions.
    summary: `${fromPath} → ${toPath} (${statusCode})${
      conflict?.type === "post" ? `, and moved "${conflict.title}" to the trash` : ""
    }`,
  })

  return NextResponse.json({ data: created ? serialize(created) : null, message: "Redirect created" })
}
