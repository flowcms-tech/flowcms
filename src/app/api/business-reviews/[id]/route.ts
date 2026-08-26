import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { businessReviews } from "@/db/tables"
import { updateBusinessReviewSchema } from "@/Modules/Settings/Reviews/Values/Validations"
import { serializeReview, parseReviewedAt } from "../route"
import { CacheService, ADMIN_CACHE_TTL_SECONDS } from "@/Framework/Redis/CacheService"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { updateReturning } from "@/db/writes"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { id } = await params
  const row = await db.query.businessReviews.findFirst({ where: eq(businessReviews.id, id) })
  if (!row) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  const data = await CacheService.remember(`business-reviews:detail:${id}`, ADMIN_CACHE_TTL_SECONDS, () =>
    Promise.resolve(serializeReview(row))
  )

  return NextResponse.json({ data, message: "OK" })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { id } = await params
  const parsed = updateBusinessReviewSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const existing = await db.query.businessReviews.findFirst({ where: eq(businessReviews.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  const updates: Partial<typeof businessReviews.$inferInsert> = {}
  if (parsed.data.authorName !== undefined) updates.authorName = parsed.data.authorName
  if (parsed.data.rating !== undefined) updates.rating = parsed.data.rating
  // Empty string means "clear this field"; absent means "leave unchanged".
  if (parsed.data.body !== undefined) updates.body = parsed.data.body || null
  if (parsed.data.source !== undefined) updates.source = parsed.data.source
  if (parsed.data.sourceUrl !== undefined) updates.sourceUrl = parsed.data.sourceUrl || null
  if (parsed.data.isPublished !== undefined) updates.isPublished = parsed.data.isPublished

  if (parsed.data.reviewedAt !== undefined) {
    const reviewedAt = parseReviewedAt(parsed.data.reviewedAt)
    if (Number.isNaN(reviewedAt.getTime())) {
      return NextResponse.json({ message: ["Review date must be a valid date"] }, { status: 422 })
    }
    if (reviewedAt.getTime() > Date.now()) {
      return NextResponse.json({ message: ["Review date cannot be in the future"] }, { status: 422 })
    }
    updates.reviewedAt = reviewedAt
  }

  // `source` is notNull for a reason — it is the audit trail behind the rating
  // markup. A PATCH must not be able to blank it out the way an optional field
  // can be cleared.
  if (updates.source !== undefined && !updates.source.trim()) {
    return NextResponse.json({ message: ["Source is required"] }, { status: 422 })
  }

  const updated = await updateReturning(businessReviews, updates, eq(businessReviews.id, id))

  await CacheService.delPattern("business-reviews:*")

  return NextResponse.json({ data: serializeReview(updated), message: "Review updated" })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { id } = await params
  const existing = await db.query.businessReviews.findFirst({ where: eq(businessReviews.id, id) })
  if (!existing) {
    return NextResponse.json({ message: "Not found" }, { status: 404 })
  }

  await db.delete(businessReviews).where(eq(businessReviews.id, id))
  await CacheService.delPattern("business-reviews:*")

  return NextResponse.json({ data: null, message: "Review deleted" })
}
