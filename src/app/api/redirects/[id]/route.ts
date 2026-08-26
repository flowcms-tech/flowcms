import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { redirects } from "@/db/tables"
import { updateRedirectSchema } from "@/Modules/Redirects/Values/Validations"
import { CacheService } from "@/Framework/Redis/CacheService"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { updateReturning } from "@/db/writes"

/** Only toPath and statusCode are editable — fromPath is what a request
 *  actually matches against, so changing it is really "create a different
 *  redirect," not an edit of this one. Delete and re-create instead. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  const parsed = updateRedirectSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const existing = await db.query.redirects.findFirst({ where: eq(redirects.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  if (parsed.data.toPath === existing.fromPath) {
    return NextResponse.json({ message: ["A path can't redirect to itself"] }, { status: 422 })
  }

  const updated = await updateReturning(redirects, { toPath: parsed.data.toPath, statusCode: parsed.data.statusCode }, eq(redirects.id, id))

  await CacheService.delPattern("redirects:*")

  // Both paths go in the summary, not just the changed one: a redirect only
  // means anything as a pair, and "changed target path" without the source is
  // an entry nobody can act on.
  await recordActivity({
    actor: session.user,
    action: "updated",
    entityType: "redirect",
    entityId: updated.id,
    entityLabel: updated.fromPath,
    summary: `${updated.fromPath} → ${updated.toPath} (${updated.statusCode})${
      existing.toPath !== updated.toPath ? `, was → ${existing.toPath}` : ""
    }`,
  })

  return NextResponse.json({
    data: {
      id: updated.id,
      fromPath: updated.fromPath,
      toPath: updated.toPath,
      statusCode: updated.statusCode,
      isAutomatic: updated.isAutomatic,
      createdAt: updated.createdAt,
    },
    message: "Redirect updated",
  })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  const existing = await db.query.redirects.findFirst({ where: eq(redirects.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  await db.delete(redirects).where(eq(redirects.id, id))
  await CacheService.delPattern("redirects:*")

  // Deleting a redirect turns a working URL back into a 404, which is the kind
  // of change nobody remembers making a month later.
  await recordActivity({
    actor: session.user,
    action: "deleted",
    entityType: "redirect",
    entityId: id,
    entityLabel: existing.fromPath,
    summary: `Deleted ${existing.fromPath} → ${existing.toPath}`,
  })

  return NextResponse.json({ data: null, message: "Redirect deleted" })
}
