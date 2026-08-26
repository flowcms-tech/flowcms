import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { searchConsoleIssues } from "@/db/tables"
import { updateIssueSchema } from "@/Modules/SearchConsole/Values/Validations"
import { changedFieldLabels, recordActivity, summariseChanges } from "@/db/activityLog"
import { SEARCH_CONSOLE_ISSUE_FIELD_LABELS } from "@/Framework/Activity/fieldLabels"
import type { SearchConsoleIssue } from "@/Modules/SearchConsole/Types"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { updateReturning } from "@/db/writes"

function serialize(row: typeof searchConsoleIssues.$inferSelect): SearchConsoleIssue {
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

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  const parsed = updateIssueSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues.map((issue) => issue.message) }, { status: 422 })
  }

  const existing = await db.query.searchConsoleIssues.findFirst({ where: eq(searchConsoleIssues.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  const updates: Partial<typeof searchConsoleIssues.$inferInsert> = { updatedAt: new Date() }
  if (parsed.data.type !== undefined) updates.type = parsed.data.type
  if (parsed.data.title !== undefined) updates.title = parsed.data.title
  if (parsed.data.description !== undefined) updates.description = parsed.data.description || null
  if (parsed.data.url !== undefined) updates.url = parsed.data.url || null
  if (parsed.data.detectedAt !== undefined) {
    updates.detectedAt = parsed.data.detectedAt ? new Date(parsed.data.detectedAt) : null
  }
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes || null

  // Resolving/reopening moves resolvedAt in lockstep with status — it must
  // never say "resolved" while carrying a stale (or missing) resolution
  // timestamp from a previous cycle.
  if (parsed.data.status !== undefined && parsed.data.status !== existing.status) {
    updates.status = parsed.data.status
    updates.resolvedAt = parsed.data.status === "resolved" ? new Date() : null
  }

  const updated = await updateReturning(searchConsoleIssues, updates, eq(searchConsoleIssues.id, id))

  const changed = changedFieldLabels(
    existing as unknown as Record<string, unknown>,
    updates as Record<string, unknown>,
    SEARCH_CONSOLE_ISSUE_FIELD_LABELS
  )

  await recordActivity({
    actor: session.user,
    action: "updated",
    entityType: "search_console_issue",
    entityId: updated.id,
    entityLabel: updated.title,
    summary: summariseChanges(changed),
  })

  return NextResponse.json({ data: serialize(updated), message: "Issue updated" })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  const existing = await db.query.searchConsoleIssues.findFirst({ where: eq(searchConsoleIssues.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  await db.delete(searchConsoleIssues).where(eq(searchConsoleIssues.id, id))

  await recordActivity({
    actor: session.user,
    action: "deleted",
    entityType: "search_console_issue",
    entityId: id,
    entityLabel: existing.title,
    summary: `Deleted logged issue: ${existing.title}`,
  })

  return NextResponse.json({ data: null, message: "Issue deleted" })
}
