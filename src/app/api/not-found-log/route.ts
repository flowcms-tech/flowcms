import { NextRequest, NextResponse } from "next/server"
import { desc, isNotNull, isNull, like } from "drizzle-orm"
import { db } from "@/db/client"
import { notFoundLog } from "@/db/tables"
import { CacheService, ADMIN_CACHE_TTL_SECONDS } from "@/Framework/Redis/CacheService"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/** Bounded so a table at its 5 000-row cap can't be pulled into one response.
 *  The rows that matter are the high-hit ones, and they sort first. */
const MAX_ROWS = 500

function serialize(row: typeof notFoundLog.$inferSelect) {
  return {
    id: row.id,
    path: row.path,
    hits: row.hits,
    lastReferrer: row.lastReferrer,
    resolvedAt: row.resolvedAt,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
  }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)
  const search = searchParams.get("search")?.trim().toLowerCase()
  const resolvedParam = searchParams.get("resolved")
  // Three states, not two: unset means "everything", which is a different
  // answer from "only the unresolved ones".
  const resolved = resolvedParam === "true" ? true : resolvedParam === "false" ? false : null

  const data = await CacheService.remember(
    `not-found-log:list:${search ?? "_"}:${resolvedParam ?? "_"}`,
    ADMIN_CACHE_TTL_SECONDS,
    async () => {
      const filters = [
        search ? like(notFoundLog.path, `%${search}%`) : undefined,
        resolved === true ? isNotNull(notFoundLog.resolvedAt) : undefined,
        resolved === false ? isNull(notFoundLog.resolvedAt) : undefined,
      ].filter((clause) => clause !== undefined)

      const rows = await db.query.notFoundLog.findMany({
        where: filters.length > 0 ? (_, { and }) => and(...filters) : undefined,
        // Hits first: the count is what separates a live broken link from a
        // one-off typo, and it is the only useful sort on this screen.
        orderBy: [desc(notFoundLog.hits), desc(notFoundLog.lastSeenAt)],
        limit: MAX_ROWS,
      })
      return rows.map(serialize)
    }
  )

  return NextResponse.json({ data, message: "OK" })
}

/**
 * Clears the rows already marked resolved.
 *
 * Only the resolved ones, and only on an explicit action: a resolved row is
 * still evidence that the fix worked, so it is kept until someone decides they
 * are done looking at it. Unresolved rows are never touched here — losing an
 * unfixed broken link is losing the work.
 */
export async function DELETE(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  await db.delete(notFoundLog).where(isNotNull(notFoundLog.resolvedAt))
  await CacheService.delPattern("not-found-log:*")

  return NextResponse.json({ data: null, message: "Resolved 404s cleared" })
}
