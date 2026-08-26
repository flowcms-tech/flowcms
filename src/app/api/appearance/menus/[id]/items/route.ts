import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { menus, menuItems } from "@/db/tables"
import { insertReturning } from "@/db/writes"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { canManageMenus, resolveRole } from "@/Framework/Auth/permissions"
import { resequence, validateParentPlacement } from "@/Framework/Navigation/menuTree"
import { sanitizeCustomTarget } from "@/Framework/Navigation/menuTarget"
import {
  createMenuItemSchema,
  reorderMenuItemsSchema,
} from "@/Modules/Appearance/Values/MenuValidations"
import { checkEntityTarget } from "@/Modules/Appearance/Queries/menuItemGuards"

/** Items in one menu: add one (POST), or rewrite the whole ordering (PUT). */

const FORBIDDEN = "You do not have permission to manage menus"
const NOT_FOUND = "That menu no longer exists"

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  if (!canManageMenus(resolveRole(session.user.role))) {
    return NextResponse.json({ message: FORBIDDEN }, { status: 403 })
  }

  const { id } = await context.params

  const parsed = createMenuItemSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 },
    )
  }

  const [menu] = await db.select().from(menus).where(eq(menus.id, id)).limit(1)
  if (!menu) return NextResponse.json({ message: NOT_FOUND }, { status: 404 })

  const { label, type, target, parentId = null, isActive = true, opensInNewTab = false } = parsed.data

  const targetProblem = await checkEntityTarget(type, target)
  if (targetProblem) return NextResponse.json({ message: [targetProblem] }, { status: 422 })

  // Placement is validated against EVERY item, not just this menu's, so a
  // parent id belonging to another menu is refused with the right message
  // rather than looking like a missing row.
  const existing = await db
    .select({ id: menuItems.id, menuId: menuItems.menuId, parentId: menuItems.parentId })
    .from(menuItems)
  const placement = validateParentPlacement({ itemId: null, menuId: id, parentId, existing })
  if (!placement.ok) return NextResponse.json({ message: [placement.error] }, { status: 422 })

  // Appended to the end of its own group. Computed from the rows rather than
  // from a count, so a gap left by a deletion cannot produce a duplicate.
  const siblings = existing.filter((row) => row.menuId === id && row.parentId === parentId)
  const rows = siblings.length
    ? await db.select({ sortOrder: menuItems.sortOrder }).from(menuItems).where(eq(menuItems.menuId, id))
    : []
  const nextOrder = rows.reduce((max, row) => Math.max(max, row.sortOrder + 1), 0)

  const now = new Date()
  const item = await insertReturning(menuItems, {
    menuId: id,
    parentId,
    label,
    type,
    // Normalised on the way in for custom links, so what is stored is exactly
    // what was validated. Non-null: the schema already refused anything the
    // sanitiser rejects.
    target: type === "custom" ? (sanitizeCustomTarget(target) as string) : target,
    sortOrder: nextOrder,
    isActive,
    opensInNewTab,
    createdAt: now,
    updatedAt: now,
  })

  await recordActivity({
    actor: session.user,
    action: "created",
    entityType: "menu_item",
    entityId: item.id,
    entityLabel: item.label,
    summary: `Added "${item.label}" to the "${menu.name}" menu`,
    metadata: { menuId: menu.id, location: menu.location, type: item.type },
  })

  return NextResponse.json({ data: item, message: "Item added" })
}

/**
 * Rewrite the order and nesting of a whole menu in one request.
 *
 * The client sends every item in the order it wants, each with its parent, and
 * the server resequences from scratch. A "move item up one" API would need the
 * server to reconstruct the client's view of the list to know what "up" meant,
 * and two people reordering at once would land on an order neither chose.
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  if (!canManageMenus(resolveRole(session.user.role))) {
    return NextResponse.json({ message: FORBIDDEN }, { status: 403 })
  }

  const { id } = await context.params

  const parsed = reorderMenuItemsSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 },
    )
  }

  const [menu] = await db.select().from(menus).where(eq(menus.id, id)).limit(1)
  if (!menu) return NextResponse.json({ message: NOT_FOUND }, { status: 404 })

  const current = await db.select().from(menuItems).where(eq(menuItems.menuId, id))
  const byId = new Map(current.map((row) => [row.id, row]))

  const submitted = parsed.data.items
  const unknown = submitted.filter((entry) => !byId.has(entry.id))
  if (unknown.length > 0) {
    return NextResponse.json(
      { message: ["Some of those items are not in this menu. Reload the page and try again."] },
      { status: 422 },
    )
  }
  if (submitted.length !== current.length) {
    // A partial ordering would leave the omitted items at whatever sortOrder
    // they had, interleaved with the new sequence in a way nobody chose.
    return NextResponse.json(
      { message: ["Send every item in the menu when reordering."] },
      { status: 422 },
    )
  }

  // Validate the WHOLE proposed shape before writing any of it, against itself
  // rather than against what is currently stored — otherwise a request that
  // moves a parent and its child in one go is judged on a state that will not
  // exist by the time it lands.
  const proposed = submitted.map((entry) => ({ id: entry.id, menuId: id, parentId: entry.parentId }))
  for (const entry of proposed) {
    const placement = validateParentPlacement({
      itemId: entry.id,
      menuId: id,
      parentId: entry.parentId,
      existing: proposed,
    })
    if (!placement.ok) return NextResponse.json({ message: [placement.error] }, { status: 422 })
  }

  const sequenced = resequence(submitted)
  const changed = sequenced.filter((entry) => {
    const row = byId.get(entry.id)
    return row?.sortOrder !== entry.sortOrder || (row?.parentId ?? null) !== entry.parentId
  })

  if (changed.length === 0) {
    // Dropping an item back where it started. Nothing written, nothing logged.
    return NextResponse.json({ data: { changed: 0 }, message: "No changes", changed: false })
  }

  const now = new Date()
  await db.transaction(async (tx) => {
    for (const entry of changed) {
      await tx
        .update(menuItems)
        .set({ sortOrder: entry.sortOrder, parentId: entry.parentId, updatedAt: now })
        .where(eq(menuItems.id, entry.id))
    }
  })

  // ONE entry for the batch, not one per row — the convention every bulk
  // operation in FlowCMS follows. Fifteen entries for one drag is noise that
  // buries the edits somebody actually needs to find.
  await recordActivity({
    actor: session.user,
    action: "moved",
    entityType: "menu",
    entityId: menu.id,
    entityLabel: menu.name,
    summary: `Reordered the "${menu.name}" menu (${changed.length} item${changed.length === 1 ? "" : "s"} moved)`,
  })

  return NextResponse.json({ data: { changed: changed.length }, message: "Menu reordered" })
}
