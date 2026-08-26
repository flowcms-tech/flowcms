import { NextRequest, NextResponse } from "next/server"
import { getBingConfig } from "@/Framework/Settings/SettingsService"
import { getUserSites } from "@/Framework/Integrations/BingWebmaster/sites"
import { BingApiError } from "@/Framework/Integrations/BingWebmaster/client"
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

  const bing = await getBingConfig()
  if (!bing.apiKey) {
    return NextResponse.json(
      { message: "Save an API key first — get one from Bing Webmaster Tools → Settings → API Access." },
      { status: 422 }
    )
  }

  try {
    const sites = await getUserSites(bing.apiKey)

    return NextResponse.json({
      data: {
        sites,
        configuredSiteUrl: bing.siteUrl,
        configuredSiteVerified: bing.siteUrl
          ? sites.some((s) => s.url === bing.siteUrl && s.isVerified)
          : false,
      },
      message: "Connection is working",
    })
  } catch (err) {
    const message = err instanceof BingApiError || err instanceof Error
      ? err.message
      : "Could not reach Bing Webmaster Tools."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
