import { NextRequest, NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPostLocks, users } from "@/db/tables"
import { getActiveLock, lockConflictMessage } from "@/db/postLocks"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { checkPostEditAccess } from "@/db/postAccess"
import { upsert } from "@/db/writes"

function lockPayload(
  status: "mine" | "locked-by-other" | "free",
  lock: { lockedBy: { id: string; name: string }; lockedAt: Date } | null
) {
  return {
    status,
    lockedBy: lock?.lockedBy ?? null,
    lockedAt: lock?.lockedAt ?? null,
  }
}

/** Status check — used for the background poll while locked out, and for the
 *  initial render before the acquire attempt resolves. Never mutates. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  const lock = await getActiveLock(id)

  if (!lock) return NextResponse.json({ data: lockPayload("free", null), message: "OK" })
  const status = lock.lockedBy.id === session.user.id ? "mine" : "locked-by-other"
  return NextResponse.json({ data: lockPayload(status, lock), message: "OK" })
}

/**
 * Acquire or heartbeat-refresh the lock.
 *
 * Upserts unconditionally when there is no active lock or it is already the
 * requester's own — that second case is what a heartbeat is, not a new
 * acquisition. Refuses with 409 when an active lock is held by someone else,
 * so a race between two admins opening the same post within the same
 * instant has a single, deterministic winner: whoever's write lands in the
 * database first.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  // Holding an edit lock on a post you may not edit is either a mistake or a
  // denial-of-service against the people who can. GET is deliberately not
  // gated this way: seeing who currently holds a lock is harmless, and the
  // posts list renders that indicator for every row.
  const access = await checkPostEditAccess(id, gate.session.user)
  if (!access.ok) {
    return NextResponse.json({ message: access.message }, { status: access.status })
  }

  const existingLock = await getActiveLock(id)
  if (existingLock && existingLock.lockedBy.id !== session.user.id) {
    return NextResponse.json(
      { data: lockPayload("locked-by-other", existingLock), message: lockConflictMessage(existingLock) },
      { status: 409 }
    )
  }

  const now = new Date()
  await upsert(
    blogPostLocks,
    { postId: id, lockedById: session.user.id, lockedAt: now },
    { target: blogPostLocks.postId, set: { lockedById: session.user.id, lockedAt: now } },
  )

  // Resolved from the DB, not session.user.name, matching how every other
  // route in this app resolves a display name — the session token is not
  // trusted as the source of truth for it.
  const actingUser = await db.query.users.findFirst({ where: eq(users.id, session.user.id) })
  const lock = { lockedBy: { id: session.user.id, name: actingUser?.name ?? "" }, lockedAt: now }
  return NextResponse.json({ data: lockPayload("mine", lock), message: "OK" })
}

/** Release — only removes a lock the requester actually holds, so a stray
 *  call (a slow unmount racing a fresh acquisition by someone else) can
 *  never delete another admin's lock. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const { id } = await params
  await db
    .delete(blogPostLocks)
    .where(and(eq(blogPostLocks.postId, id), eq(blogPostLocks.lockedById, session.user.id)))

  return NextResponse.json({ data: null, message: "OK" })
}
