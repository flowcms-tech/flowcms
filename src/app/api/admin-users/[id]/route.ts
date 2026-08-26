import { NextRequest, NextResponse } from "next/server"
import { and, eq, ne, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db/client"
import { users } from "@/db/tables"
import { hashPassword } from "@/Framework/Auth/password"
import {
  ROLES,
  canAssignRole,
  canChangeRole,
  canDemoteOwner,
  canManageUsers,
  resolveRole,
} from "@/Framework/Auth/permissions"
import { serializeUser } from "../route"
import { changedFieldLabels, recordActivity, summariseChanges } from "@/db/activityLog"
import { USER_FIELD_LABELS } from "@/Framework/Activity/fieldLabels"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { updateReturning } from "@/db/writes"

const patchSchema = z.object({
  name:     z.string().min(1, 'Name is required').max(100).optional(),
  email:    z.string().min(1, 'Email is required').email('Invalid email').max(100).optional(),
  password: z.string().min(6, 'Password must be at least 6 characters').max(100).optional(),
  isActive: z.boolean().optional(),
  role:     z.enum(ROLES).optional(),
})

/**
 * How many *other* owners could still administer the site if this one went
 * away — counting only active accounts, because a deactivated owner cannot log
 * in to fix anything and is therefore no safety net at all.
 *
 * Every guard below is written against this number rather than a raw owner
 * count, so "the last owner" means the same thing whether it is being demoted,
 * deactivated, or deleted.
 */
async function countOtherActiveOwners(excludeUserId: string): Promise<number> {
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(users)
    .where(and(eq(users.role, "owner"), eq(users.isActive, true), ne(users.id, excludeUserId)))
  return Number(total)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate
  if (!canManageUsers(resolveRole(session.user.role))) {
    return NextResponse.json({ message: "Only an owner or admin can manage staff accounts" }, { status: 403 })
  }

  const { id } = await params
  const user = await db.query.users.findFirst({ where: eq(users.id, id) })
  if (!user) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ data: serializeUser(user), message: "OK" })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  const body = await request.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const existing = await db.query.users.findFirst({ where: eq(users.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  /**
   * The actor's role is read from the database here, not from the session.
   *
   * Everywhere else the JWT's ≤60s-fresh copy is fine, because the worst case
   * is a stale editor keeping edit rights for another minute. This route is the
   * one that *grants* rights, so a stale token is the difference between "was
   * demoted a moment ago" and "can still promote themselves back". One read on
   * an endpoint used a handful of times a year is not a cost worth optimising.
   */
  const actor = await db.query.users.findFirst({ where: eq(users.id, session.user.id) })
  if (!actor || !canManageUsers(resolveRole(actor.role))) {
    return NextResponse.json({ message: "Only an owner or admin can manage staff accounts" }, { status: 403 })
  }
  const actorRole = resolveRole(actor.role)
  const targetRole = resolveRole(existing.role)

  if (parsed.data.isActive === false && id === session.user.id) {
    return NextResponse.json(
      { message: "You cannot deactivate your own account" },
      { status: 400 }
    )
  }

  // An owner is the only account that can grant the owner role, so deactivating
  // the last active one leaves a site nobody can fully administer — and nobody
  // to undo it, because undoing it requires the account being disabled.
  if (parsed.data.isActive === false && targetRole === "owner") {
    if ((await countOtherActiveOwners(id)) === 0) {
      return NextResponse.json(
        { message: ["This is the last active owner. Promote another account to owner first."] },
        { status: 422 }
      )
    }
  }

  if (parsed.data.role !== undefined && parsed.data.role !== targetRole) {
    const nextRole = parsed.data.role

    if (!canChangeRole(actorRole, targetRole)) {
      return NextResponse.json(
        { message: "Only an owner can change another owner's role" },
        { status: 403 }
      )
    }
    if (!canAssignRole(actorRole, nextRole)) {
      return NextResponse.json(
        { message: ["Only an owner can grant the owner role"] },
        { status: 422 }
      )
    }

    // An owner can only be demoted by itself. "Another owner did it" is the
    // same lockout by a different route, and a panel that can lock out its own
    // owner is a support call waiting to happen.
    if (targetRole === "owner" && !canDemoteOwner(session.user.id, id)) {
      return NextResponse.json(
        { message: "An owner can only be demoted by themselves" },
        { status: 403 }
      )
    }
    if (targetRole === "owner" && (await countOtherActiveOwners(id)) === 0) {
      return NextResponse.json(
        { message: ["This is the last active owner. Promote another account to owner first."] },
        { status: 422 }
      )
    }
  }

  if (parsed.data.email && parsed.data.email !== existing.email) {
    const emailTaken = await db.query.users.findFirst({ where: eq(users.email, parsed.data.email) })
    if (emailTaken) {
      return NextResponse.json({ message: ["Email is already in use"] }, { status: 422 })
    }
  }

  const updates: Partial<typeof users.$inferInsert> = { updatedAt: new Date() }
  if (parsed.data.name !== undefined) updates.name = parsed.data.name
  if (parsed.data.email !== undefined) updates.email = parsed.data.email
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive
  if (parsed.data.role !== undefined) updates.role = parsed.data.role
  if (parsed.data.password) updates.passwordHash = await hashPassword(parsed.data.password)

  const updated = await updateReturning(users, updates, eq(users.id, id))

  // Role and active-state moves are spelled out rather than left as "changed
  // role": who granted whom what, and when, is the reason an audit log exists
  // at all. The password is reported as a fact and never as a value — see the
  // note on USER_FIELD_LABELS.
  const notes: string[] = []
  if (updates.role !== undefined && updates.role !== existing.role) {
    notes.push(`Role ${resolveRole(existing.role)} → ${resolveRole(updated.role)}`)
  }
  if (updates.isActive !== undefined && updates.isActive !== existing.isActive) {
    notes.push(updated.isActive ? "Reactivated the account" : "Deactivated the account")
  }
  if (updates.passwordHash) notes.push("Set a new password")
  const changed = changedFieldLabels(existing, updates, USER_FIELD_LABELS)
  if (notes.length === 0) notes.push(summariseChanges(changed))

  await recordActivity({
    actor: session.user,
    action: "updated",
    entityType: "user",
    entityId: updated.id,
    entityLabel: updated.name ?? updated.email,
    summary: notes.join(" · "),
    metadata: { changed },
  })

  return NextResponse.json({ data: serializeUser(updated), message: "Admin user updated" })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params

  if (id === session.user.id) {
    return NextResponse.json(
      { message: "You cannot delete your own account" },
      { status: 400 }
    )
  }

  const existing = await db.query.users.findFirst({ where: eq(users.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  const actor = await db.query.users.findFirst({ where: eq(users.id, session.user.id) })
  if (!actor || !canManageUsers(resolveRole(actor.role))) {
    return NextResponse.json({ message: "Only an owner or admin can manage staff accounts" }, { status: 403 })
  }

  // Deleting an owner is demotion taken to its conclusion, so it obeys the same
  // rule — and since self-deletion is already refused above, the practical
  // effect is that an owner account has to be demoted before it can be removed.
  // That is the intended friction, not an oversight.
  if (resolveRole(existing.role) === "owner") {
    return NextResponse.json(
      { message: "An owner account has to demote itself before it can be deleted" },
      { status: 403 }
    )
  }

  await db.delete(users).where(eq(users.id, id))

  // The deleted account's own entries keep their `actorName` but lose
  // `actorId` (the FK is `set null`), so this row is what explains why a name
  // in the log suddenly stops matching any current staff member.
  await recordActivity({
    actor: session.user,
    action: "deleted",
    entityType: "user",
    entityId: id,
    entityLabel: existing.name ?? existing.email,
    summary: `Deleted the ${resolveRole(existing.role)} account ${existing.email}`,
  })

  return NextResponse.json({ data: null, message: "Admin user deleted" })
}
