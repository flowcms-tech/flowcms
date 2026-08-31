import { NextRequest, NextResponse } from "next/server"
import {
  guardMigrationRequest,
  migrationErrorResponse,
} from "@/Framework/Storage/Migration/migrationApi"
import {
  entriesQuerySchema,
} from "@/Framework/Storage/Migration/migrationRequests"
/**
 * The detailed report: which keys, and what is wrong with them.
 *
 * PAGINATED AND CAPPED AT THE DATABASE. A store with half a million objects
 * would otherwise turn one admin page load into half a million rows serialised
 * into a JSON response. The durable table stays the source of truth; this is a
 * window onto it.
 *
 * The object KEY is returned deliberately: an operator resolving a conflict has
 * to know which file. Hashes are not — they identify nothing anybody can act on
 * and would multiply the payload for no one's benefit.
 */

export async function GET(request: NextRequest) {
  const gate = await guardMigrationRequest(request)
  if (!gate.ok) return gate.response

  const url = new URL(request.url)
  const parsed = entriesQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue: { message: string }) => issue.message) },
      { status: 422 },
    )
  }

  try {
    const { migrationId, classification, state, limit, offset } = parsed.data
    const result = await gate.service.entries(
      migrationId,
      { classification, state },
      { limit, offset },
    )
    return NextResponse.json({ data: result, message: "OK" })
  } catch (error) {
    return migrationErrorResponse(error)
  }
}
