import { adminLoginPath, adminPath } from "@/Framework/Config/adminPath"
import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { randomBytes } from "crypto"
import { auth } from "@/Framework/Auth/auth"
import { getBaseUrl, getGscConfig, getGscRedirectUri } from "@/Framework/Settings/SettingsService"
import { buildAuthUrl } from "@/Framework/Integrations/GoogleSearchConsole"
import { canManageSettings, resolveRole } from "@/Framework/Auth/permissions"

export const GSC_OAUTH_STATE_COOKIE = "gsc_oauth_state"

/**
 * Real browser navigation, not a BAPI call — the whole point is to leave
 * this app and land on Google's own consent screen, then come back via the
 * callback route below.
 */
export async function GET() {
  // Built from the same trusted getBaseUrl() the outbound redirect_uri uses —
  // never from request.url. The dev server binds with `-H 0.0.0.0`, and
  // request.url's origin can come back as 0.0.0.0 (unreachable in a browser)
  // regardless of which origin the browser actually used to get here.
  const baseUrl = await getBaseUrl()

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL(adminLoginPath(), baseUrl))
  }
  // A browser navigation, so the refusal is a redirect with a message rather
  // than a JSON 403 — a raw error body is not a page anyone can act on.
  if (!canManageSettings(resolveRole(session.user.role))) {
    const url = new URL(adminPath("/settings/integrations"), baseUrl)
    url.searchParams.set("gscError", "Only an owner or admin can connect integrations.")
    return NextResponse.redirect(url)
  }

  const [gsc, redirectUri] = await Promise.all([getGscConfig(), getGscRedirectUri()])
  if (!gsc.clientId || !gsc.clientSecret) {
    const url = new URL(adminPath("/settings/integrations"), baseUrl)
    url.searchParams.set("gscError", "Save a Client ID and Client Secret before connecting.")
    return NextResponse.redirect(url)
  }

  const state = randomBytes(24).toString("hex")
  const cookieStore = await cookies()
  cookieStore.set(GSC_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  })

  const authUrl = buildAuthUrl(
    { clientId: gsc.clientId, clientSecret: gsc.clientSecret, redirectUri },
    state
  )

  return NextResponse.redirect(authUrl)
}
