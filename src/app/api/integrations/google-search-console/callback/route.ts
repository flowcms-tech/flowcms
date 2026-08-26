import { adminLoginPath, adminPath } from "@/Framework/Config/adminPath"
import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { db } from "@/db/client"
import { settings } from "@/db/tables"
import { SETTINGS_SINGLETON_ID } from "@/db/schema/settings"
import { auth } from "@/Framework/Auth/auth"
import { getBaseUrl, getGscConfig, getGscRedirectUri, invalidateSettingsCache } from "@/Framework/Settings/SettingsService"
import { exchangeCodeForRefreshToken } from "@/Framework/Integrations/GoogleSearchConsole"
import { canManageSettings, resolveRole } from "@/Framework/Auth/permissions"
import { GSC_OAUTH_STATE_COOKIE } from "../auth/route"
import { upsert } from "@/db/writes"

function redirectWithError(baseUrl: string, message: string) {
  const url = new URL(adminPath("/settings/integrations"), baseUrl)
  url.searchParams.set("gscError", message)
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  // Built from the same trusted getBaseUrl() the outbound redirect_uri uses —
  // never from request.url. The dev server binds with `-H 0.0.0.0`, and
  // request.url's origin can come back as 0.0.0.0 (unreachable in a browser)
  // depending on how the request arrived, even though Google itself redirected
  // here over the correct, registered localhost origin.
  const baseUrl = await getBaseUrl()

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL(adminLoginPath(), baseUrl))
  }
  // Re-checked here and not only on the outbound leg: the callback is a plain
  // GET anyone can replay, and it is the half that actually stores a token.
  if (!canManageSettings(resolveRole(session.user.role))) {
    return redirectWithError(baseUrl, "Only an owner or admin can connect integrations.")
  }

  const cookieStore = await cookies()
  const expectedState = cookieStore.get(GSC_OAUTH_STATE_COOKIE)?.value
  cookieStore.delete(GSC_OAUTH_STATE_COOKIE)

  const code = request.nextUrl.searchParams.get("code")
  const state = request.nextUrl.searchParams.get("state")
  const googleError = request.nextUrl.searchParams.get("error")

  if (googleError) {
    return redirectWithError(baseUrl, `Google denied the request: ${googleError}`)
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectWithError(baseUrl, "The connection request expired or was invalid. Please try again.")
  }

  const [gsc, redirectUri] = await Promise.all([getGscConfig(), getGscRedirectUri()])
  if (!gsc.clientId || !gsc.clientSecret) {
    return redirectWithError(baseUrl, "Save a Client ID and Client Secret before connecting.")
  }

  try {
    const refreshToken = await exchangeCodeForRefreshToken(
      { clientId: gsc.clientId, clientSecret: gsc.clientSecret, redirectUri },
      code
    )

    await upsert(
      settings,
      { id: SETTINGS_SINGLETON_ID, gscRefreshToken: refreshToken, updatedAt: new Date() },
      { target: settings.id, set: { gscRefreshToken: refreshToken, updatedAt: new Date() } },
    )

    await invalidateSettingsCache()
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to complete the Google connection."
    return redirectWithError(baseUrl, message)
  }

  const url = new URL(adminPath("/settings/integrations"), baseUrl)
  url.searchParams.set("gscConnected", "1")
  return NextResponse.redirect(url)
}
