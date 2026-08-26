import { NextRequest, NextResponse } from "next/server"
import { desc } from "drizzle-orm"
import { db } from "@/db/client"
import { businessReviews } from "@/db/tables"
import { createBusinessReviewSchema } from "@/Modules/Settings/Reviews/Values/Validations"
import { CacheService, ADMIN_CACHE_TTL_SECONDS } from "@/Framework/Redis/CacheService"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { insertReturning } from "@/db/writes"

type ReviewRow = typeof businessReviews.$inferSelect

export function serializeReview(row: ReviewRow) {
  return {
    id: row.id,
    authorName: row.authorName,
    rating: row.rating,
    body: row.body,
    source: row.source,
    sourceUrl: row.sourceUrl,
    reviewedAt: row.reviewedAt,
    isPublished: row.isPublished,
    createdAt: row.createdAt,
  }
}

/** The form sends 'yyyy-MM-dd' (ElementDatePicker's storage shape). Anchoring
 *  at local midnight keeps the date the admin picked the date that reads back
 *  into the form, rather than sliding a day either way through UTC. */
export function parseReviewedAt(ymd: string): Date {
  return new Date(`${ymd}T00:00:00`)
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)
  const search = searchParams.get("search")?.trim().toLowerCase() || undefined

  const data = await CacheService.remember(`business-reviews:list:${search ?? "_"}`, ADMIN_CACHE_TTL_SECONDS, async () => {
    const rows = await db.query.businessReviews.findMany({ orderBy: desc(businessReviews.reviewedAt) })
    const filtered = search
      ? rows.filter(
          (row) =>
            row.authorName.toLowerCase().includes(search) ||
            row.source.toLowerCase().includes(search) ||
            (row.body ?? "").toLowerCase().includes(search)
        )
      : rows
    return filtered.map(serializeReview)
  })

  return NextResponse.json({ data, message: "OK" })
}

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const parsed = createBusinessReviewSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 }
    )
  }

  const reviewedAt = parseReviewedAt(parsed.data.reviewedAt)
  if (Number.isNaN(reviewedAt.getTime())) {
    return NextResponse.json({ message: ["Review date must be a valid date"] }, { status: 422 })
  }
  // A review dated in the future cannot be one a customer has left. Cheap to
  // check, and it catches the typo that would otherwise sit at the top of the
  // list forever.
  if (reviewedAt.getTime() > Date.now()) {
    return NextResponse.json({ message: ["Review date cannot be in the future"] }, { status: 422 })
  }

  const created = await insertReturning(businessReviews, {
      authorName: parsed.data.authorName,
      rating: parsed.data.rating,
      body: parsed.data.body || null,
      source: parsed.data.source,
      sourceUrl: parsed.data.sourceUrl || null,
      reviewedAt,
      isPublished: parsed.data.isPublished ?? false,
    })

  await CacheService.delPattern("business-reviews:*")

  return NextResponse.json({ data: serializeReview(created), message: "Review added" })
}
