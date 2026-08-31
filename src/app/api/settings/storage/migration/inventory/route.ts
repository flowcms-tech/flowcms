import { NextRequest, NextResponse } from "next/server"
import {
  guardMigrationRequest,
  migrationErrorResponse,
  parseBody,
} from "@/Framework/Storage/Migration/migrationApi"
import {
  batchSchema,
} from "@/Framework/Storage/Migration/migrationRequests"
/**
 * One bounded batch of inventory.
 *
 * ONE BATCH PER REQUEST, NEVER THE WHOLE SCAN. A store can hold more objects
 * than any HTTP request can enumerate, and a request that tried would be one
 * timeout away from losing everything it had found. The browser asks again; the
 * cursor lives in the database, so a closed tab loses nothing.
 */

export async function POST(request: NextRequest) {
  const gate = await guardMigrationRequest(request)
  if (!gate.ok) return gate.response

  const body = await parseBody(request, batchSchema)
  if (!body.ok) return body.response

  try {
    const result = await gate.service.runInventoryBatch(body.data.migrationId, {
      batchSize: body.data.batchSize,
    })
    return NextResponse.json({ data: result, message: "OK" })
  } catch (error) {
    return migrationErrorResponse(error)
  }
}
