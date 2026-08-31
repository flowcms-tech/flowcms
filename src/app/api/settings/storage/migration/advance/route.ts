import { NextRequest, NextResponse } from "next/server"
import {
  advanceSchema,
  guardMigrationRequest,
  migrationErrorResponse,
  parseBody,
} from "@/Framework/Storage/Migration/migrationApi"

/**
 * One bounded batch of transfer, or a deliberate retry of what failed.
 *
 * Both live here because they are the same operation seen from either end —
 * "do the next piece of work" and "put this piece of work back" — and splitting
 * them would leave two places that have to agree on which states are claimable.
 *
 * IN VERIFY-ONLY MODE THIS COPIES NOTHING. The engine refuses to write to the
 * destination in that mode structurally rather than by checking a flag here;
 * see `migrationEngine.ts`.
 *
 * RETRY IS NARROW ON PURPOSE. It returns transient failures to the queue and
 * leaves conflicts and unrepresentable keys where they are: those are not
 * network blips, and a retry that quietly re-attempted them would either loop
 * forever or overwrite a file the migration does not own.
 */

export async function POST(request: NextRequest) {
  const gate = await guardMigrationRequest(request)
  if (!gate.ok) return gate.response

  const body = await parseBody(request, advanceSchema)
  if (!body.ok) return body.response

  try {
    const result =
      body.data.action === "retry"
        ? await gate.service.retryFailed(body.data.migrationId)
        : await gate.service.runTransferBatch(body.data.migrationId, {
            batchSize: body.data.batchSize,
            concurrency: body.data.concurrency,
          })

    return NextResponse.json({ data: result, message: "OK" })
  } catch (error) {
    return migrationErrorResponse(error)
  }
}
