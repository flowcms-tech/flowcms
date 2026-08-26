import { NextRequest, NextResponse } from "next/server"
import { desc, eq } from "drizzle-orm"
import { db } from "@/db/client"
import { searchConsoleIssues } from "@/db/tables"
import { createIssueSchema } from "@/Modules/SearchConsole/Values/Validations"
import { recordActivity } from "@/db/activityLog"
import type { SearchConsoleIssue } from "@/Modules/SearchConsole/Types"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { insertReturning } from "@/db/writes"

/** Exported for reuse by the Page Profile route, which needs the same
 *  row → API-shape mapping for its `url`-filtered issue lookup. */
export function serialize(row: typeof searchConsoleIssues.$inferSelect): SearchConsoleIssue {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    url: row.url,
    detectedAt: row.detectedAt ? row.detectedAt.toISOString() : null,
    status: row.status,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const rows = await db.query.searchConsoleIssues.findMany({
    orderBy: desc(searchConsoleIssues.createdAt),
  })

  return NextResponse.json({ data: rows.map(serialize), message: "OK" })
}

/** Shared with the Action Feed route — the full open list, not a page of
 *  it, since the feed needs every open issue represented as its own item. */
export async function getOpenIssues(): Promise<SearchConsoleIssue[]> {
  const rows = await db.query.searchConsoleIssues.findMany({
    where: eq(searchConsoleIssues.status, "open"),
    orderBy: desc(searchConsoleIssues.createdAt),
  })
  return rows.map(serialize)
}

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const parsed = createIssueSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues.map((issue) => issue.message) }, { status: 422 })
  }

  const { type, title, description, url, detectedAt, status, notes } = parsed.data

  const created = await insertReturning(searchConsoleIssues, {
      type,
      title,
      description: description || null,
      url: url || null,
      detectedAt: detectedAt ? new Date(detectedAt) : null,
      status,
      resolvedAt: status === "resolved" ? new Date() : null,
      notes: notes || null,
      createdBy: session.user.id,
    })

  await recordActivity({
    actor: session.user,
    action: "created",
    entityType: "search_console_issue",
    entityId: created.id,
    entityLabel: title,
    summary: `Logged a ${type === "manual_action" ? "manual action" : "security issue"}: ${title}`,
  })

  return NextResponse.json({ data: serialize(created), message: "Issue logged" })
}
