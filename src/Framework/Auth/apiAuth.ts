import { NextResponse } from "next/server"
import type { Session } from "next-auth"
import { auth } from "./auth"
import { resolveRole, type Role } from "./permissions"
import { isAuthorizedForAccess, resolveRouteAccess } from "./routePolicies"

/**
 * The single authentication + authorization gate for every non-public route
 * handler under `src/app/api`.
 *
 * Replaces the idiom that used to be repeated 134 times across 84 files:
 *
 *     const session = await auth()
 *     if (!session?.user?.id) {
 *       return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
 *     }
 *
 * That checked *who* the caller is and never *what they may do*. This checks
 * both, by looking the request's path up in ROUTE_POLICIES (see
 * routePolicies.ts for why the floor lives in a table rather than in each
 * handler).
 *
 * FAILS CLOSED. A path with no registry entry is denied — including a route
 * added tomorrow by someone who did not read this file. That is deliberate: the
 * accompanying coverage test turns the same omission into a failing test long
 * before it can reach production, but if it ever did, the endpoint would be
 * unreachable rather than unprotected.
 *
 * Usage:
 *
 *     export async function POST(request: NextRequest) {
 *       const gate = await requireApiAuth(request)
 *       if (!gate.ok) return gate.response
 *       const { session } = gate
 *       ...
 *     }
 *
 * The floor this applies is a MINIMUM. Handlers with finer rules — post
 * ownership, "only an owner may mint an owner", the last-owner-standing check —
 * still run them afterwards, unchanged.
 */

/**
 * A session that has cleared the gate. The `user.id` guarantee comes from the
 * project's own `next-auth.d.ts` augmentation, so downstream `session.user.id`
 * and `session.user` reads need no narrowing.
 */
export type AuthenticatedSession = Session

export type ApiAuthResult =
  | { ok: true; session: AuthenticatedSession; userId: string; role: Role }
  | { ok: false; response: NextResponse }

/**
 * 403 rather than 404 for an insufficient role, and a message that names the
 * requirement rather than the caller's current role.
 *
 * Existing handlers that already return their own tailored 403 (settings,
 * admin-users, the post ownership checks) keep those messages — this is only
 * the generic floor.
 */
function forbidden(): NextResponse {
  return NextResponse.json(
    { message: "You do not have permission to perform this action" },
    { status: 403 }
  )
}

function unauthorized(): NextResponse {
  return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
}

export async function requireApiAuth(request: Request): Promise<ApiAuthResult> {
  const { pathname } = new URL(request.url)
  const resolved = resolveRouteAccess(pathname, request.method)

  if (!resolved) {
    // No policy => deny. Logged because it is always a mistake rather than an
    // attack: someone added a route and did not add its entry.
    console.error(
      `[apiAuth] No route policy for ${request.method} ${pathname}. ` +
        `Denying by default. Add an entry to ROUTE_POLICIES in ` +
        `src/Framework/Auth/routePolicies.ts.`
    )
    return { ok: false, response: forbidden() }
  }

  if (resolved.access === "public") {
    // A public route should not be calling this — it would 401 every anonymous
    // visitor. Surface it loudly in development rather than silently allowing,
    // because "requireApiAuth on a public route" is a policy/handler mismatch
    // worth fixing either way.
    console.error(
      `[apiAuth] ${resolved.pattern} is declared public but called ` +
        `requireApiAuth(). Fix the policy or the handler.`
    )
  }

  const session = await auth()
  if (!session?.user?.id) return { ok: false, response: unauthorized() }

  const role = resolveRole(session.user.role)
  if (!isAuthorizedForAccess(resolved.access, role)) {
    return { ok: false, response: forbidden() }
  }

  return { ok: true, session, userId: session.user.id, role }
}
