import { NextRequest, NextResponse } from "next/server"
import {
  ACTIVITY_PER_PAGE,
  listActivity,
  listActivityActors,
  pruneExpiredActivity,
  type ActivityFilters,
  type ActivityRow,
} from "@/db/activityLog"
import { isActivityAction, isActivityEntityType } from "@/Framework/Activity/activityTypes"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * The activity log's only endpoint — read-only, and there is no write route on
 * purpose.
 *
 * Entries are produced as a side effect of the operations they describe (see
 * `recordActivity`), never posted by a client. An audit trail anything can
 * write to is not an audit trail, and a route that accepts an arbitrary
 * `actorName` is a route that can be used to forge one.
 *
 * Readable by any signed-in panel user. That is a deliberate product call: the
 * log's value is that everyone can see what changed, and a blog team of four
 * does not need the history hidden from half of it. Nothing sensitive lands
 * here — entries carry names, labels, and which fields moved, never field
 * values or credentials.
 */

function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function serialize(row: ActivityRow) {
  return {
    id: row.id,
    actorId: row.actorId,
    actorName: row.actorName,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    entityLabel: row.entityLabel,
    summary: row.summary,
    // Parsed here so the client never has to. A row whose JSON was hand-edited
    // yields null rather than 500-ing the screen that would show it.
    metadata: (() => {
      if (!row.metadata) return null
      try {
        return JSON.parse(row.metadata) as Record<string, unknown>
      } catch {
        return null
      }
    })(),
    createdAt: row.createdAt,
  }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)

  // Unknown filter values are dropped rather than rejected: a stale bookmark
  // with `?action=archived` should show the unfiltered log, not a 422.
  const actionParam = searchParams.get("action")
  const entityTypeParam = searchParams.get("entityType")

  const filters: ActivityFilters = {
    action: isActivityAction(actionParam) ? actionParam : undefined,
    entityType: isActivityEntityType(entityTypeParam) ? entityTypeParam : undefined,
    entityId: searchParams.get("entityId")?.trim() || undefined,
    actorId: searchParams.get("actorId")?.trim() || undefined,
    search: searchParams.get("search")?.trim() || undefined,
    from: parseDate(searchParams.get("from")),
    to: parseDate(searchParams.get("to")),
    page: Math.max(1, Number(searchParams.get("page") ?? "1") || 1),
    perPage: ACTIVITY_PER_PAGE,
  }

  // Retention runs here rather than on a timer — there is no cron in this app,
  // and this is the one request path that is both administrative and rare.
  await pruneExpiredActivity()

  const [{ rows, total }, actors] = await Promise.all([listActivity(filters), listActivityActors()])

  return NextResponse.json({
    data: {
      current_page: filters.page,
      per_page: ACTIVITY_PER_PAGE,
      total,
      data: rows.map(serialize),
      // Shipped with the page rather than from a second endpoint: the filter
      // dropdown needs it on first paint, and it is a handful of rows.
      actors,
    },
    message: "OK",
  })
}
