import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { menus } from "@/db/tables"
import { insertReturning } from "@/db/writes"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { canManageMenus, resolveRole } from "@/Framework/Auth/permissions"
import { createMenuSchema } from "@/Modules/Appearance/Values/MenuValidations"
import { getMenuAdminView, installedSlots } from "@/Modules/Appearance/Queries/menuAdminQueries"

/**
 * Appearance → Menus.
 *
 * GET returns the whole screen's model — every menu, its items with resolved
 * hrefs, and which slots installed themes declare. POST creates a menu for a
 * slot.
 *
 * THE WRITE PATH IS STRICT AND THE READ PATH IS RESILIENT, the same asymmetry
 * as theme activation. Creating a menu requires a location some installed theme
 * actually declares; reading returns whatever is stored, including a menu whose
 * slot no current theme has. New unusable state is never created, and existing
 * state is never deleted or rewritten because a theme changed.
 */

const FORBIDDEN = "You do not have permission to manage menus"

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  if (!canManageMenus(resolveRole(gate.session.user.role))) {
    return NextResponse.json({ message: FORBIDDEN }, { status: 403 })
  }

  return NextResponse.json({ data: await getMenuAdminView(), message: "OK" })
}

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  if (!canManageMenus(resolveRole(session.user.role))) {
    return NextResponse.json({ message: FORBIDDEN }, { status: 403 })
  }

  const parsed = createMenuSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 },
    )
  }

  const { name, location } = parsed.data

  // A location no installed theme declares would be a menu nothing could ever
  // render. Refusing it here is what stops a typo becoming an invisible menu
  // the operator keeps editing and never sees.
  const known = installedSlots().some((entry) => entry.slot === location)
  if (!known) {
    const offered = installedSlots().map((entry) => entry.slot)
    return NextResponse.json(
      {
        message: [
          offered.length > 0
            ? `No installed theme has a "${location}" menu location. Available locations: ${offered.join(", ")}.`
            : `No installed theme declares any menu locations, so there is nowhere to put a menu.`,
        ],
      },
      { status: 422 },
    )
  }

  const [existing] = await db.select().from(menus).where(eq(menus.location, location)).limit(1)
  if (existing) {
    // The unique constraint would catch this too, but a driver error is not a
    // sentence anyone can act on.
    return NextResponse.json(
      { message: [`The "${location}" location already has a menu ("${existing.name}").`] },
      { status: 422 },
    )
  }

  const now = new Date()
  const menu = await insertReturning(menus, { name, location, createdAt: now, updatedAt: now })

  await recordActivity({
    actor: session.user,
    action: "created",
    entityType: "menu",
    entityId: menu.id,
    entityLabel: menu.name,
    summary: `Created the "${menu.name}" menu in the ${menu.location} location`,
  })

  return NextResponse.json({ data: menu, message: "Menu created" })
}
