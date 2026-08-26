import { NextRequest, NextResponse } from "next/server"
import { getGscConfig, getGscRedirectUri } from "@/Framework/Settings/SettingsService"
import { listSites } from "@/Framework/Integrations/GoogleSearchConsole"
import { canManageSettings, resolveRole } from "@/Framework/Auth/permissions"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate
  if (!canManageSettings(resolveRole(session.user.role))) {
    return NextResponse.json(
      { message: "Only an owner or admin can manage integrations" },
      { status: 403 }
    )
  }

  const [gsc, redirectUri] = await Promise.all([getGscConfig(), getGscRedirectUri()])
  if (!gsc.clientId || !gsc.clientSecret || !gsc.refreshToken) {
    return NextResponse.json(
      { message: "Not connected yet — click Connect to Google to authorize this app." },
      { status: 422 }
    )
  }

  try {
    const sites = await listSites(
      { clientId: gsc.clientId, clientSecret: gsc.clientSecret, redirectUri },
      gsc.refreshToken
    )

    return NextResponse.json({
      data: {
        sites,
        configuredSiteUrl: gsc.siteUrl,
        configuredSiteVerified: gsc.siteUrl ? sites.some((s) => s.siteUrl === gsc.siteUrl) : false,
      },
      message: "Connection is working",
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach Google Search Console."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
