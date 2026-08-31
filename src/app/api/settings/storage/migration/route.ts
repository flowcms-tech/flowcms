import { NextRequest, NextResponse } from "next/server"
import {
  guardMigrationRequest,
  migrationErrorResponse,
  parseBody,
} from "@/Framework/Storage/Migration/migrationApi"
import {
  acknowledgeSchema,
  cancelSchema,
  createMigrationSchema,
} from "@/Framework/Storage/Migration/migrationRequests"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
/**
 * The storage migration itself: read it, start one, acknowledge, cancel.
 *
 * DELIBERATELY NOT PART OF `settings/global`. That route's PATCH is the
 * ordinary settings save, and its topology guard exists precisely to refuse a
 * bucket change made there. Relocating storage through the same endpoint would
 * mean the guard had to distinguish "the save that is allowed to move files"
 * from every other save — exactly the ambiguity that made a settings form able
 * to lose an installation's media in the first place.
 *
 * Every handler is a thin shell over `migrationService`. None of them sequences
 * anything: the ordering that makes a migration safe lives in one place, and a
 * route that assembled its own would be a second copy of it.
 */

export async function GET(request: NextRequest) {
  const gate = await guardMigrationRequest(request)
  if (!gate.ok) return gate.response

  // A named migration is read ON ITS OWN, open or finished. The snapshot
  // describes the installation right now; this answers "what did that one do",
  // which is the question a completed relocation has to keep answering.
  const migrationId = new URL(request.url).searchParams.get("migrationId")
  if (migrationId !== null) {
    if (!UUID.test(migrationId)) {
      return NextResponse.json({ message: "Not a migration id." }, { status: 422 })
    }
    try {
      return NextResponse.json({ data: await gate.service.describeJob(migrationId), message: "OK" })
    } catch (error) {
      return migrationErrorResponse(error)
    }
  }

  try {
    return NextResponse.json({ data: await gate.service.snapshot(), message: "OK" })
  } catch (error) {
    return migrationErrorResponse(error)
  }
}

/** Matches the id format the rest of this API validates with Zod. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  const gate = await guardMigrationRequest(request)
  if (!gate.ok) return gate.response

  const body = await parseBody(request, createMigrationSchema)
  if (!body.ok) return body.response

  try {
    const job = await gate.service.create(body.data)

    // The LOCATION is logged, never the credentials: `destination.label` comes
    // from `describeLocation`, which redacts endpoint userinfo and has no field
    // a secret fits in.
    await log(request, "created", `Storage migration started to ${job.destination.label}`)

    return NextResponse.json({ data: job, message: "Migration created" }, { status: 201 })
  } catch (error) {
    return migrationErrorResponse(error)
  }
}

/** Acknowledging the destination's extra files. The only PATCH-able fact. */
export async function PATCH(request: NextRequest) {
  const gate = await guardMigrationRequest(request)
  if (!gate.ok) return gate.response

  const body = await parseBody(request, acknowledgeSchema)
  if (!body.ok) return body.response

  try {
    const result = await gate.service.acknowledgeExtras(body.data.migrationId, body.data.version)
    await log(
      request,
      "updated",
      `Acknowledged ${result.acknowledged} extra file(s) already at the migration destination`,
    )
    return NextResponse.json({ data: result, message: "Acknowledged" })
  } catch (error) {
    return migrationErrorResponse(error)
  }
}

export async function DELETE(request: NextRequest) {
  const gate = await guardMigrationRequest(request)
  if (!gate.ok) return gate.response

  const body = await parseBody(request, cancelSchema)
  if (!body.ok) return body.response

  try {
    const result = await gate.service.cancel(
      body.data.migrationId,
      body.data.version,
      body.data.reason,
    )
    await log(request, "deleted", "Storage migration cancelled; nothing at the destination removed")
    return NextResponse.json({ data: result, message: "Migration cancelled" })
  } catch (error) {
    return migrationErrorResponse(error)
  }
}

/** The audit trail. Never carries a credential — see the note in POST. */
async function log(
  request: NextRequest,
  action: "created" | "updated" | "deleted",
  summary: string,
) {
  const auth = await requireApiAuth(request)
  if (!auth.ok) return
  await recordActivity({
    actor: auth.session.user,
    action,
    entityType: "settings",
    entityId: null,
    entityLabel: "Storage migration",
    summary,
  }).catch(() => {})
}
