import NextAuth from "next-auth"
import { NextResponse, type NextRequest } from "next/server"
import { authConfig } from "@/Framework/Auth/auth.config"
import {
  classifyRequestPath,
  resolveAdminPathFrom,
  toInternalAdminPath,
} from "@/Framework/Config/adminPathCore"

// Deliberately built from authConfig only (no adapter, no providers) so this
// bundle never imports the db client — Next's proxy loader can't resolve
// Bun-native modules like bun:sqlite. The `authorized` callback in
// auth.config.ts does the actual role check against the already-decoded JWT.
const { auth } = NextAuth(authConfig)

// Resolved once, at module load. Read here rather than through
// Framework/Config/adminPath.ts because that module imports `server-only`,
// which does not belong in the proxy bundle. The core module is pure.
const PUBLIC_ADMIN_PATH = resolveAdminPathFrom(process.env.FLOWCMS_ADMIN_PATH)

/**
 * Admin routing and admin authentication, in that order.
 *
 * The public admin path is operator configuration, so it cannot appear in the
 * matcher below — Next requires matchers to be statically analyzable constants.
 * The matcher is therefore an exclusion list, and this function does the real
 * classification. That is why classification has to be cheap: a request for a
 * blog post reaches the first line here and must leave immediately, without
 * touching a session or the database.
 *
 *   public   → next(), untouched
 *   internal → 404, indistinguishable from any other missing page
 *   admin    → authenticate, then rewrite onto the internal route
 *
 * The two admin branches look contradictory — one rewrites ONTO /admin-panel,
 * the other refuses requests FOR /admin-panel — and they are not, because Next
 * does not re-run the proxy on an internal rewrite destination. That was
 * verified empirically before this design was built (see the spec). If a future
 * Next version changes it, the symptom is an immediate 404 on every admin page,
 * which is loud rather than silent.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const requestClass = classifyRequestPath(pathname, PUBLIC_ADMIN_PATH)

  if (requestClass === "public") return NextResponse.next()

  if (requestClass === "internal") {
    // Rewriting to a path that cannot exist makes Next render the application's
    // own not-found page with a 404 status, so this is byte-identical to any
    // other missing URL. A redirect would confirm both that the internal route
    // exists and where the panel actually lives.
    return NextResponse.rewrite(new URL("/_flowcms_internal_not_found", request.url))
  }

  // Admin namespace. `auth()` runs authConfig's `authorized` callback, which
  // sees the PUBLIC path because this is pre-rewrite, and redirects to the
  // configured public login page when there is no session.
  return auth(() => {
    const url = request.nextUrl.clone()
    url.pathname = toInternalAdminPath(pathname, PUBLIC_ADMIN_PATH)
    return NextResponse.rewrite(url)
  })(request, undefined as never)
}

export const config = {
  /**
   * Everything except static assets, image optimization, and routes that can
   * never be the admin panel.
   *
   * Broader than the previous `/admin-panel/:path*`, and necessarily so: a
   * runtime-configurable path cannot be named by a build-time constant. `/api`
   * stays excluded — Phase 1's requireApiAuth route registry already gates every
   * API route, so running this over them would add cost and no protection.
   */
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap).*)"],
}
