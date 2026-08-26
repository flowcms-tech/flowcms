import { NextRequest, NextResponse } from "next/server"
import { desc, eq, like, or, sql } from "drizzle-orm"
import { db } from "@/db/client"
import { users } from "@/db/tables"
import { hashPassword } from "@/Framework/Auth/password"
import { createAdminUserSchema } from "@/Modules/AdminUsers/Values/Validations"
import { canAssignRole, canManageUsers, resolveRole } from "@/Framework/Auth/permissions"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { insertReturning } from "@/db/writes"

const PER_PAGE = 10

export function serializeUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    name: user.name ?? "",
    email: user.email,
    isActive: user.isActive,
    role: resolveRole(user.role),
  }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  // Reading the staff list is itself administrative — it enumerates every
  // account and what each one can do.
  if (!canManageUsers(resolveRole(session.user.role))) {
    return NextResponse.json({ message: "Only an owner or admin can manage staff accounts" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const search = searchParams.get("search")?.trim() || undefined
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1)

  const where = search
    ? or(like(users.name, `%${search}%`), like(users.email, `%${search}%`))
    : undefined

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(users)
    .where(where)

  const rows = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(PER_PAGE)
    .offset((page - 1) * PER_PAGE)

  return NextResponse.json({
    data: {
      current_page: page,
      data: rows.map(serializeUser),
      per_page: PER_PAGE,
      total,
    },
    message: "OK",
  })
}

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const actorRole = resolveRole(session.user.role)
  if (!canManageUsers(actorRole)) {
    return NextResponse.json({ message: "Only an owner or admin can create staff accounts" }, { status: 403 })
  }

  const body = await request.json()
  const parsed = createAdminUserSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  // Only an owner can mint another owner. Otherwise an admin could create an
  // owner account, sign in as it, and demote the real owner — privilege
  // escalation assembled from two individually legal steps.
  if (!canAssignRole(actorRole, parsed.data.role)) {
    return NextResponse.json(
      { message: ["Only an owner can create another owner account"] },
      { status: 422 }
    )
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.email, parsed.data.email),
  })
  if (existing) {
    return NextResponse.json({ message: ["Email is already in use"] }, { status: 422 })
  }

  const passwordHash = await hashPassword(parsed.data.password)

  const created = await insertReturning(users, {
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash,
      isActive: true,
      role: parsed.data.role,
    })

  await recordActivity({
    actor: session.user,
    action: "created",
    entityType: "user",
    entityId: created.id,
    entityLabel: created.name ?? created.email,
    summary: `Created a ${parsed.data.role} account for ${created.email}`,
  })

  return NextResponse.json({ data: serializeUser(created), message: "Admin user created" })
}
