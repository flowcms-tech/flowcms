import { NextRequest, NextResponse } from "next/server"
import { getBingConfig } from "@/Framework/Settings/SettingsService"
import {
  getCountryRegionSettings,
  addCountryRegionSettings,
  removeCountryRegionSettings,
  type CountryRegionSetting,
} from "@/Framework/Integrations/BingWebmaster/siteSettings"
import { BingApiError } from "@/Framework/Integrations/BingWebmaster/client"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

interface ListResponse {
  status: "ok" | "not_connected"
  reason: string | null
  items: CountryRegionSetting[]
}

const NOT_CONNECTED: ListResponse = {
  status: "not_connected",
  reason: "Bing Webmaster Tools is not connected. Connect it under Settings → Integrations.",
  items: [],
}

/**
 * Authentication + authorization for every method on this route, via the
 * shared gate. The floor ("admin") is declared once in ROUTE_POLICIES rather
 * than restated here, so this route cannot drift away from the rest of the
 * integrations surface.
 */
async function requireAccess(request: Request) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return { error: gate.response } as const
  return { session: gate.session } as const
}

function errorMessage(err: unknown): string {
  return err instanceof BingApiError || err instanceof Error ? err.message : "Could not reach Bing Webmaster Tools."
}

export async function GET(request: NextRequest) {
  const access = await requireAccess(request)
  if (access.error) return access.error

  const bing = await getBingConfig()
  if (!bing.apiKey || !bing.siteUrl) {
    return NextResponse.json({ data: NOT_CONNECTED, message: "Not connected" })
  }

  try {
    const items = await getCountryRegionSettings(bing.apiKey, bing.siteUrl)
    return NextResponse.json({ data: { status: "ok", reason: null, items } satisfies ListResponse, message: "Loaded" })
  } catch (err) {
    return NextResponse.json({ message: [errorMessage(err)] }, { status: 422 })
  }
}

export async function POST(request: NextRequest) {
  const access = await requireAccess(request)
  if (access.error) return access.error

  const bing = await getBingConfig()
  if (!bing.apiKey || !bing.siteUrl) {
    return NextResponse.json({ message: "Bing Webmaster Tools is not connected." }, { status: 422 })
  }

  const body = (await request.json()) as { twoLetterIsoCountryCode?: string; type?: number; url?: string }
  if (!body.twoLetterIsoCountryCode || body.type === undefined || !body.url) {
    return NextResponse.json({ message: ["twoLetterIsoCountryCode, type, and url are required"] }, { status: 422 })
  }

  try {
    await addCountryRegionSettings(bing.apiKey, bing.siteUrl, {
      twoLetterIsoCountryCode: body.twoLetterIsoCountryCode,
      type: body.type,
      url: body.url,
    })
    await recordActivity({
      actor: access.session!.user,
      action: "created",
      entityType: "bing_site_settings",
      entityId: null,
      entityLabel: "Bing Webmaster site settings",
      summary: `Added ${body.twoLetterIsoCountryCode} geo-targeting for ${body.url} on Bing`,
    })
    const items = await getCountryRegionSettings(bing.apiKey, bing.siteUrl)
    return NextResponse.json({ data: { status: "ok", reason: null, items } satisfies ListResponse, message: "Regional setting added" })
  } catch (err) {
    return NextResponse.json({ message: [errorMessage(err)] }, { status: 422 })
  }
}

export async function DELETE(request: NextRequest) {
  const access = await requireAccess(request)
  if (access.error) return access.error

  const bing = await getBingConfig()
  if (!bing.apiKey || !bing.siteUrl) {
    return NextResponse.json({ message: "Bing Webmaster Tools is not connected." }, { status: 422 })
  }

  const body = (await request.json()) as { twoLetterIsoCountryCode?: string; type?: number; url?: string }
  if (!body.twoLetterIsoCountryCode || body.type === undefined || !body.url) {
    return NextResponse.json({ message: ["twoLetterIsoCountryCode, type, and url are required"] }, { status: 422 })
  }

  try {
    await removeCountryRegionSettings(bing.apiKey, bing.siteUrl, {
      twoLetterIsoCountryCode: body.twoLetterIsoCountryCode,
      type: body.type,
      url: body.url,
    })
    await recordActivity({
      actor: access.session!.user,
      action: "deleted",
      entityType: "bing_site_settings",
      entityId: null,
      entityLabel: "Bing Webmaster site settings",
      summary: `Removed ${body.twoLetterIsoCountryCode} geo-targeting for ${body.url} on Bing`,
    })
    const items = await getCountryRegionSettings(bing.apiKey, bing.siteUrl)
    return NextResponse.json({ data: { status: "ok", reason: null, items } satisfies ListResponse, message: "Regional setting removed" })
  } catch (err) {
    return NextResponse.json({ message: [errorMessage(err)] }, { status: 422 })
  }
}
