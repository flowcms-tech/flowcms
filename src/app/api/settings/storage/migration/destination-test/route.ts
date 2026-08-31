import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import {
  guardMigrationRequest,
  migrationErrorResponse,
  parseBody,
} from "@/Framework/Storage/Migration/migrationApi"

/**
 * Proving the destination works before anything depends on it.
 *
 * Write, read back, compare, delete — and, for a filesystem destination, find
 * out whether it distinguishes `Photo.png` from `photo.png`. "The bucket
 * exists" is not the claim that matters: a credential that can list but not
 * write passes a HeadBucket and then fails on every object a migration copies,
 * several thousand objects in.
 *
 * NOTHING IT RETURNS CAN CARRY A CREDENTIAL. The failure messages are written
 * by `destinationTest.ts` from a small set of named causes; the raw exception,
 * which carries the endpoint and sometimes signed headers, never leaves the
 * process.
 */

const schema = z.object({ migrationId: z.string().uuid() })

export async function POST(request: NextRequest) {
  const gate = await guardMigrationRequest(request)
  if (!gate.ok) return gate.response

  const body = await parseBody(request, schema)
  if (!body.ok) return body.response

  try {
    const result = await gate.service.testDestination(body.data.migrationId)
    return NextResponse.json({
      data: { ...result, job: await gate.service.describeActiveJob() },
      message: result.ok ? "Destination verified" : "Destination test failed",
    })
  } catch (error) {
    return migrationErrorResponse(error)
  }
}
