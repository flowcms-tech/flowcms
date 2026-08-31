import { NextResponse } from "next/server"
import type { z } from "zod"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { canManageSettings, resolveRole } from "@/Framework/Auth/permissions"
import { isSameOriginRequest } from "@/Framework/Setup/sameOrigin"
import { MigrationServiceError } from "./migrationService"
import { getMigrationService } from "./migrationRuntime"
import type { MigrationService } from "./migrationService"

/**
 * THE GATE IN FRONT OF EVERY MIGRATION ENDPOINT.
 *
 * Moving an installation's files is the single most destructive thing its admin
 * panel can start, so the checks are stricter than the rest of the API and they
 * live in one function rather than six handlers.
 *
 * ROLE. Admin, on reads as well as writes. The status response names the
 * destination bucket, the endpoint, the object keys of every conflict and the
 * shape of the site's storage — an editor has no reason to see any of it, and a
 * contributor who could enumerate object keys through a migration report would
 * have found a way around the File Manager's own limits.
 *
 * ORIGIN. Every mutation must be same-origin. FlowCMS's ordinary mutations rely
 * on the Auth.js session cookie, which is `SameSite=Lax` and therefore not sent
 * on a cross-site POST — that is real protection and it is why the rest of the
 * API does not do this. It is not, however, protection anybody wrote down, and
 * a future change to the cookie policy would silently remove it. For the one
 * endpoint family that can repoint an installation's storage, the check is made
 * explicit and enforced here, using the same helper first-run setup uses.
 *
 * The cost is stated rather than hidden: a non-browser client must send an
 * `Origin` header to drive a migration. The alternative — allowing a request
 * whose origin cannot be determined — is how origin checks become decorative.
 */

const FORBIDDEN = "Only an owner or admin can manage storage migrations"

export type MigrationGate =
  | { ok: true; service: MigrationService }
  | { ok: false; response: NextResponse }

export async function guardMigrationRequest(request: Request): Promise<MigrationGate> {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return { ok: false, response: gate.response }

  if (!canManageSettings(resolveRole(gate.session.user.role))) {
    return { ok: false, response: NextResponse.json({ message: FORBIDDEN }, { status: 403 }) }
  }

  const method = request.method.toUpperCase()
  if (method !== "GET" && method !== "HEAD" && !isSameOriginRequest(request.headers)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          message:
            "This request did not come from this site. Storage migration actions must be started " +
            "from the FlowCMS admin panel.",
        },
        { status: 403 },
      ),
    }
  }

  return { ok: true, service: getMigrationService() }
}

/**
 * Turns anything a handler throws into a response.
 *
 * A `MigrationServiceError` carries the status and the operator-facing reasons
 * it was built with. ANYTHING ELSE BECOMES A BARE 500 with no detail: an
 * unexpected error on this path can be an AWS SDK exception, and those carry
 * the endpoint, the bucket and sometimes signed headers.
 */
export function migrationErrorResponse(error: unknown): NextResponse {
  if (error instanceof MigrationServiceError) {
    return NextResponse.json({ message: error.reasons }, { status: error.status })
  }

  console.error("[storage-migration] unhandled error", (error as Error)?.name ?? "unknown")
  return NextResponse.json(
    { message: "The migration could not be updated. Reload to see the current state." },
    { status: 500 },
  )
}

/**
 * An unrecognised field is REFUSED, and says why.
 *
 * Zod’s own text names the key and stops there. On this API the key that
 * matters is a filesystem path on a local destination, and "unrecognized key:
 * root" does not tell the operator that the path is deployment configuration
 * rather than something they may choose. Every other unrecognised field gets
 * the same treatment for consistency: silently dropping input a client believed
 * it was sending is how a request appears to succeed at something it did not do.
 */
function describeIssue(issue: { code: string; message: string; keys?: string[] }): string {
  if (issue.code !== "unrecognized_keys") return issue.message

  const keys = (issue.keys ?? []).join(", ")
  return (
    `This request contained field(s) that are not accepted here: ${keys}. In particular, a local ` +
    `destination’s path is set by the deployment’s LOCAL_STORAGE_PATH and cannot be chosen from ` +
    `the browser — a path that points outside the persistent volume loses every file on the next ` +
    `restart.`
  )
}

/** Parses a JSON body, answering 422 with the messages rather than throwing. */
export async function parseBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ message: "Expected a JSON body." }, { status: 422 }),
    }
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { message: parsed.error.issues.map(describeIssue) },
        { status: 422 },
      ),
    }
  }

  return { ok: true, data: parsed.data }
}
