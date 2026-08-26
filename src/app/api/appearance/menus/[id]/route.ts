import { NextRequest, NextResponse } from "next/server"
import { and, eq, ne } from "drizzle-orm"
import { db } from "@/db/client"
import { menus, menuItems } from "@/db/tables"
import { updateReturning } from "@/db/writes"
import { changedFieldLabels, recordActivity, summariseChanges } from "@/db/activityLog"
import { MENU_FIELD_LABELS } from "@/Framework/Activity/fieldLabels"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { canManageMenus, resolveRole } from "@/Framework/Auth/permissions"
import { updateMenuSchema } from "@/Modules/Appearance/Values/MenuValidations"
import { installedSlots } from "@/Modules/Appearance/Queries/menuAdminQueries"

/** One menu: rename it, move it to another location, or delete it. */

const FORBIDDEN = "You do not have permission to manage menus"
const NOT_FOUND = "That menu no longer exists"

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  if (!canManageMenus(resolveRole(session.user.role))) {
    return NextResponse.json({ message: FORBIDDEN }, { status: 403 })
  }

  const { id } = await context.params

  const parsed = updateMenuSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 },
    )
  }

  const [existing] = await db.select().from(menus).where(eq(menus.id, id)).limit(1)
  if (!existing) return NextResponse.json({ message: NOT_FOUND }, { status: 404 })

  const updates = parsed.data

  if (updates.location !== undefined && updates.location !== existing.location) {
    if (!installedSlots().some((entry) => entry.slot === updates.location)) {
      return NextResponse.json(
        { message: [`No installed theme has a "${updates.location}" menu location.`] },
        { status: 422 },
      )
    }
    const [clash] = await db
      .select()
      .from(menus)
      .where(and(eq(menus.location, updates.location), ne(menus.id, id)))
      .limit(1)
    if (clash) {
      return NextResponse.json(
        { message: [`The "${updates.location}" location already has a menu ("${clash.name}").`] },
        { status: 422 },
      )
    }
  }

  const changed = changedFieldLabels(existing, updates, MENU_FIELD_LABELS)
  if (changed.length === 0) {
    // Nothing to write and nothing to log. A PATCH that sets a field to the
    // value it already holds is a save button pressed twice, not an edit — and
    // an "updated" entry for it makes the log less trustworthy, not more.
    return NextResponse.json({ data: existing, message: "No changes", changed: false })
  }

  const menu = await updateReturning(menus, { ...updates, updatedAt: new Date() }, eq(menus.id, id))

  await recordActivity({
    actor: session.user,
    action: "updated",
    entityType: "menu",
    entityId: menu.id,
    entityLabel: menu.name,
    summary: summariseChanges(changed),
  })

  return NextResponse.json({ data: menu, message: "Menu updated" })
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  if (!canManageMenus(resolveRole(session.user.role))) {
    return NextResponse.json({ message: FORBIDDEN }, { status: 403 })
  }

  const { id } = await context.params

  const [existing] = await db.select().from(menus).where(eq(menus.id, id)).limit(1)
  if (!existing) return NextResponse.json({ message: NOT_FOUND }, { status: 404 })

  // Items are deleted explicitly rather than left to the cascade. The FK does
  // cascade on all four engines, but doing it here means the same code path
  // runs everywhere and the row count is known before the menu is gone.
  const removed = await db.transaction(async (tx) => {
    const items = await tx.select({ id: menuItems.id }).from(menuItems).where(eq(menuItems.menuId, id))
    await tx.delete(menuItems).where(eq(menuItems.menuId, id))
    await tx.delete(menus).where(eq(menus.id, id))
    return items.length
  })

  await recordActivity({
    actor: session.user,
    action: "deleted",
    entityType: "menu",
    entityId: existing.id,
    entityLabel: existing.name,
    summary: `Deleted the "${existing.name}" menu (${existing.location}) and its ${removed} item${removed === 1 ? "" : "s"}`,
  })

  return NextResponse.json({ data: { id: existing.id, items: removed }, message: "Menu deleted" })
}
