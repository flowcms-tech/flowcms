import { NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { db } from "@/db/client"
import { menus, menuItems } from "@/db/tables"
import { updateReturning } from "@/db/writes"
import { changedFieldLabels, recordActivity, summariseChanges } from "@/db/activityLog"
import { MENU_ITEM_FIELD_LABELS } from "@/Framework/Activity/fieldLabels"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { canManageMenus, resolveRole } from "@/Framework/Auth/permissions"
import { validateParentPlacement } from "@/Framework/Navigation/menuTree"
import { sanitizeCustomTarget } from "@/Framework/Navigation/menuTarget"
import { updateMenuItemSchema } from "@/Modules/Appearance/Values/MenuValidations"
import { checkEntityTarget } from "@/Modules/Appearance/Queries/menuItemGuards"

/** One menu item: edit it or delete it. */

const FORBIDDEN = "You do not have permission to manage menus"
const NOT_FOUND = "That menu item no longer exists"

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; itemId: string }> },
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  if (!canManageMenus(resolveRole(session.user.role))) {
    return NextResponse.json({ message: FORBIDDEN }, { status: 403 })
  }

  const { id, itemId } = await context.params

  const parsed = updateMenuItemSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 },
    )
  }

  const [existing] = await db
    .select()
    .from(menuItems)
    .where(and(eq(menuItems.id, itemId), eq(menuItems.menuId, id)))
    .limit(1)
  if (!existing) return NextResponse.json({ message: NOT_FOUND }, { status: 404 })

  const updates = { ...parsed.data }

  // The effective type and target after this patch, since either may be
  // omitted. Validating the merged pair is the only way a PATCH that changes
  // only `target` on an existing custom item gets checked at all.
  const nextType = updates.type ?? existing.type
  const nextTarget = updates.target ?? existing.target

  if (updates.type !== undefined || updates.target !== undefined) {
    if (nextType === "custom") {
      const safe = sanitizeCustomTarget(nextTarget)
      if (safe === null) {
        return NextResponse.json(
          {
            message: [
              "A link must be a path starting with / or a full http(s) address. Other schemes are not allowed.",
            ],
          },
          { status: 422 },
        )
      }
      updates.target = safe
      updates.type = nextType
    } else {
      const problem = await checkEntityTarget(nextType, nextTarget)
      if (problem) return NextResponse.json({ message: [problem] }, { status: 422 })
      updates.target = nextTarget
      updates.type = nextType
    }
  }

  if (updates.parentId !== undefined && (updates.parentId ?? null) !== existing.parentId) {
    const all = await db
      .select({ id: menuItems.id, menuId: menuItems.menuId, parentId: menuItems.parentId })
      .from(menuItems)
    const placement = validateParentPlacement({
      itemId,
      menuId: id,
      parentId: updates.parentId ?? null,
      existing: all,
    })
    if (!placement.ok) return NextResponse.json({ message: [placement.error] }, { status: 422 })
  }

  const changed = changedFieldLabels(existing, updates, MENU_ITEM_FIELD_LABELS)
  if (changed.length === 0) {
    return NextResponse.json({ data: existing, message: "No changes", changed: false })
  }

  const item = await updateReturning(
    menuItems,
    { ...updates, updatedAt: new Date() },
    eq(menuItems.id, itemId),
  )

  await recordActivity({
    actor: session.user,
    action: "updated",
    entityType: "menu_item",
    entityId: item.id,
    entityLabel: item.label,
    summary: summariseChanges(changed),
    metadata: { menuId: id },
  })

  return NextResponse.json({ data: item, message: "Item updated" })
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; itemId: string }> },
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  if (!canManageMenus(resolveRole(session.user.role))) {
    return NextResponse.json({ message: FORBIDDEN }, { status: 403 })
  }

  const { id, itemId } = await context.params

  const [existing] = await db
    .select()
    .from(menuItems)
    .where(and(eq(menuItems.id, itemId), eq(menuItems.menuId, id)))
    .limit(1)
  if (!existing) return NextResponse.json({ message: NOT_FOUND }, { status: 404 })

  const [menu] = await db.select().from(menus).where(eq(menus.id, id)).limit(1)

  // Children go with the parent, in one transaction and in application code.
  // The self-referencing foreign key is `set null` — chosen because InnoDB has
  // documented caveats around cascading self-referential deletes and this has
  // to behave identically on four engines — so leaving it to the database
  // would PROMOTE the children to the top level instead, putting links
  // somewhere the operator never chose.
  const removedChildren = await db.transaction(async (tx) => {
    const children = await tx
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(eq(menuItems.parentId, itemId))
    await tx.delete(menuItems).where(eq(menuItems.parentId, itemId))
    await tx.delete(menuItems).where(eq(menuItems.id, itemId))
    return children.length
  })

  await recordActivity({
    actor: session.user,
    action: "deleted",
    entityType: "menu_item",
    entityId: existing.id,
    entityLabel: existing.label,
    summary:
      removedChildren > 0
        ? `Removed "${existing.label}" and ${removedChildren} item${removedChildren === 1 ? "" : "s"} under it from the "${menu?.name ?? "menu"}" menu`
        : `Removed "${existing.label}" from the "${menu?.name ?? "menu"}" menu`,
    metadata: { menuId: id },
  })

  return NextResponse.json({
    data: { id: existing.id, removedChildren },
    message: "Item removed",
  })
}
