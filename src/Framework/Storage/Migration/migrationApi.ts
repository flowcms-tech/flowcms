import { NextResponse } from "next/server"
import { z } from "zod"
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

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

/**
 * The destination a create request may name.
 *
 * NOTE WHAT IS NOT HERE: a local root. A Local destination is deployment
 * configuration read from `LOCAL_STORAGE_PATH`, and a request that carried a
 * path would make an admin session a file-write primitive anywhere the process
 * can reach. `buildDestinationConfig` discards the field even if one is sent;
 * the schema simply never accepts it in the first place.
 */
export const createMigrationSchema = z.object({
  mode: z.enum(["copy", "verify"], {
    message:
      'Choose "copy" for FlowCMS to migrate the files, or "verify" if you have already migrated ' +
      "them yourself.",
  }),
  destination: z.object({
    driver: z.enum(["s3", "local"]),
    endpoint: z.string().trim().max(2048).optional(),
    region: z.string().trim().max(255).optional(),
    bucket: z.string().trim().max(255).optional(),
    accessKeyId: z.string().trim().max(512).optional(),
    secretAccessKey: z.string().max(2048).optional(),
  }),
})

export const acknowledgeSchema = z.object({
  acknowledgeExtras: z.literal(true),
  migrationId: z.string().uuid(),
  version: z.number().int().min(0),
})

export const cancelSchema = z.object({
  migrationId: z.string().uuid(),
  version: z.number().int().min(0),
  reason: z.string().trim().max(500).optional(),
})

export const batchSchema = z.object({
  migrationId: z.string().uuid(),
  /** Capped again in the service; a client cannot ask for unbounded work. */
  batchSize: z.number().int().min(1).max(500).optional(),
  concurrency: z.number().int().min(1).max(8).optional(),
})

export const advanceSchema = batchSchema.extend({
  action: z.enum(["transfer", "retry"]).default("transfer"),
})

export const cutoverSchema = z.object({
  migrationId: z.string().uuid(),
  version: z.number().int().min(0),
  /**
   * The deliberate final confirmation.
   *
   * A separate required field rather than "you called the endpoint, so you must
   * have meant it". This is the request that makes the destination
   * authoritative and cannot be undone, and a retried or replayed POST that
   * happened to reach it should not be one keystroke away from doing so.
   */
  confirm: z.literal(true, {
    message: "The cutover has to be confirmed explicitly.",
  }),
})

export const entriesQuerySchema = z.object({
  migrationId: z.string().uuid(),
  classification: z
    .enum(["missing", "matching", "conflicting", "destination_only", "incompatible"])
    .optional(),
  state: z
    .enum([
      "pending",
      "copying",
      "copied",
      "verified",
      "blocked",
      "failed",
      "source_changed",
      "source_deleted",
      "reconciled",
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
})

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
        { message: parsed.error.issues.map((issue) => issue.message) },
        { status: 422 },
      ),
    }
  }

  return { ok: true, data: parsed.data }
}
