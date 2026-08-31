import { NextRequest, NextResponse } from "next/server"
import {
  cutoverSchema,
  guardMigrationRequest,
  migrationErrorResponse,
  parseBody,
} from "@/Framework/Storage/Migration/migrationApi"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * THE IRREVERSIBLE STEP.
 *
 * This route does not cut over. It calls `performCutover`, which is the one
 * place the critical section's ordering exists — take the lock, compute the
 * final delta against a frozen source, reconcile, verify by SHA-256, commit in
 * a single transaction, invalidate caches, clear the temporary credentials,
 * release.
 *
 * NO ROUTE IN FLOWCMS CAN REACH `commitActiveStorage` OR THE LOCK DIRECTLY, and
 * that is the point of the split: an endpoint that could take the lock without
 * the delta, or commit without the verification, would be a second and shorter
 * implementation of the most dangerous operation the product has.
 *
 * THE STATUS IS CHOSEN FROM THE OUTCOME, and a dropped connection is never
 * success. A client that loses this response must re-read the migration state,
 * which is derived from the durable topology rather than from what this handler
 * managed to say.
 */

export async function POST(request: NextRequest) {
  const gate = await guardMigrationRequest(request)
  if (!gate.ok) return gate.response

  const body = await parseBody(request, cutoverSchema)
  if (!body.ok) return body.response

  try {
    const result = await gate.service.cutover(body.data.migrationId)

    if (result.outcome === "completed") {
      await log(request, "Storage cutover completed; the previous storage was left untouched")
      return NextResponse.json({
        data: { ...result, job: await gate.service.describeActiveJob() },
        message: "Storage switched to the destination",
      })
    }

    if (result.outcome === "needs_recovery") {
      // 503 rather than 409: this is not a client mistake, and repeating the
      // same request is not the answer. The state has to be re-read.
      return NextResponse.json({ data: result, message: result.reasons }, { status: 503 })
    }

    await log(request, "Storage cutover stopped; nothing was switched")
    return NextResponse.json({ data: result, message: result.reasons }, { status: 409 })
  } catch (error) {
    return migrationErrorResponse(error)
  }
}

async function log(request: NextRequest, summary: string) {
  const auth = await requireApiAuth(request)
  if (!auth.ok) return
  await recordActivity({
    actor: auth.session.user,
    action: "updated",
    entityType: "settings",
    entityId: null,
    entityLabel: "Storage migration",
    summary,
  }).catch(() => {})
}
