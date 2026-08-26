import type { NextAuthConfig } from "next-auth"
import { NextResponse } from "next/server"
import {
  joinAdminPath,
  resolveAdminPathFrom,
} from "@/Framework/Config/adminPathCore"
import { resolveRole } from "./permissions"
import { resolveAuthSecret } from "./authSecretConfig"

// Shared config with no database/adapter access, safe to import from proxy.ts
// (Next's proxy bundle cannot load Bun-native modules like bun:sqlite, even
// though Bun runs the dev/prod server itself — so proxy must not pull in
// anything that transitively imports the db client). The full config in
// auth.ts extends this with the Drizzle adapter and the Credentials provider.
//
// The admin path comes from the pure core module rather than
// Framework/Config/adminPath.ts for the same reason: that module imports
// `server-only`, and this file ends up inside the proxy bundle.
const PUBLIC_ADMIN_PATH = resolveAdminPathFrom(process.env.FLOWCMS_ADMIN_PATH)
const LOGIN_PATH = joinAdminPath(PUBLIC_ADMIN_PATH, "/login")

export const authConfig = {
  pages: { signIn: LOGIN_PATH },
  session: { strategy: "jwt" },
  trustHost: true,
  /**
   * The session-signing secret, supplied from the validated source rather
   * than left for Auth.js to read out of the environment unexamined (Phase
   * 7.1.2).
   *
   * `resolveAuthSecret()` returns the configured value only when it passes the
   * shared deployment-secret policy. When it does not, that module has already
   * REMOVED the rejected value from the environment, so Auth.js finds nothing
   * to fall back to and refuses to sign or verify anything — see the long note
   * in `authSecretConfig.ts` for why supplying an empty string was not enough.
   *
   * It lands here rather than in `auth.ts` so that `src/proxy.ts`, which builds
   * its own NextAuth from this config to verify the admin JWT, applies the same
   * judgement. The public site is unaffected either way: the proxy returns
   * before touching auth for every non-admin request.
   */
  secret: resolveAuthSecret(),
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl

      // The proxy runs this BEFORE rewriting onto the internal route, so the
      // pathname here is the PUBLIC one. Comparing against /admin-panel would
      // never match, and the login page would sit behind the login page.
      if (pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`)) return true

      if (auth?.user?.id) return true

      // Returning a Response rather than `false`, and this is load-bearing.
      //
      // next-auth dispatches on mutually exclusive branches (see
      // next-auth/lib/index.js): a Response wins outright; otherwise a wrapper
      // middleware runs and the boolean is DISCARDED; only with no wrapper does
      // `false` produce the sign-in redirect. src/proxy.ts must wrap auth() to
      // perform the admin-path rewrite, so returning `false` here would compute
      // the right answer and throw it away, rendering every protected page for
      // anonymous visitors. Pinned by tests/auth/adminPathAuthorization.test.ts.
      // Relative rather than absolute, deviating from next-auth's default.
      // An absolute callbackUrl is the classic open-redirect shape, and under
      // `next dev -H 0.0.0.0` it also serializes the bind address rather than
      // the host the browser used. A path cannot leave the origin.
      const target = `${request.nextUrl.pathname}${request.nextUrl.search}`
      const signInUrl = request.nextUrl.clone()
      signInUrl.pathname = LOGIN_PATH
      signInUrl.search = ""
      signInUrl.searchParams.set("callbackUrl", target)
      return NextResponse.redirect(signInUrl)
    },
    session({ session, token }) {
      if (token.id) {
        session.user.id = token.id
        // Read off the token, never from the database — this file is imported
        // by src/proxy.ts, which must stay DB-free. The token's `role` is kept
        // fresh by auth.ts's existing ≤60s revocation read.
        session.user.role = resolveRole(token.role)
      } else {
        // token invalidated (deactivated/deleted user) — treat as signed out
        session.user = undefined as never
      }
      return session
    },
  },
} satisfies NextAuthConfig
