import { NextRequest, NextResponse } from "next/server"
import { getBingConfig } from "@/Framework/Settings/SettingsService"
import { getBlockedUrls, addBlockedUrl, removeBlockedUrl, type BlockedUrl } from "@/Framework/Integrations/BingWebmaster/siteSettings"
import { BingApiError } from "@/Framework/Integrations/BingWebmaster/client"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

interface ListResponse {
  status: "ok" | "not_connected"
  reason: string | null
  items: BlockedUrl[]
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

export async function GET(request: NextRequest) {
  const access = await requireAccess(request)
  if (access.error) return access.error

  const bing = await getBingConfig()
  if (!bing.apiKey || !bing.siteUrl) {
    return NextResponse.json({ data: NOT_CONNECTED, message: "Not connected" })
  }

  try {
    const items = await getBlockedUrls(bing.apiKey, bing.siteUrl)
    return NextResponse.json({ data: { status: "ok", reason: null, items } satisfies ListResponse, message: "Loaded" })
  } catch (err) {
    const message = err instanceof BingApiError || err instanceof Error ? err.message : "Could not reach Bing Webmaster Tools."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}

export async function POST(request: NextRequest) {
  const access = await requireAccess(request)
  if (access.error) return access.error

  const bing = await getBingConfig()
  if (!bing.apiKey || !bing.siteUrl) {
    return NextResponse.json({ message: "Bing Webmaster Tools is not connected." }, { status: 422 })
  }

  const body = (await request.json()) as { url?: string; entityType?: number; requestType?: number }
  if (!body.url || body.entityType === undefined || body.requestType === undefined) {
    return NextResponse.json({ message: ["url, entityType, and requestType are required"] }, { status: 422 })
  }

  try {
    await addBlockedUrl(bing.apiKey, bing.siteUrl, { url: body.url, entityType: body.entityType, requestType: body.requestType })
    await recordActivity({
      actor: access.session!.user,
      action: "created",
      entityType: "bing_site_settings",
      entityId: null,
      entityLabel: "Bing Webmaster site settings",
      summary: `Blocked ${body.url} on Bing`,
    })
    const items = await getBlockedUrls(bing.apiKey, bing.siteUrl)
    return NextResponse.json({ data: { status: "ok", reason: null, items } satisfies ListResponse, message: "URL blocked" })
  } catch (err) {
    const message = err instanceof BingApiError || err instanceof Error ? err.message : "Could not reach Bing Webmaster Tools."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}

export async function DELETE(request: NextRequest) {
  const access = await requireAccess(request)
  if (access.error) return access.error

  const bing = await getBingConfig()
  if (!bing.apiKey || !bing.siteUrl) {
    return NextResponse.json({ message: "Bing Webmaster Tools is not connected." }, { status: 422 })
  }

  const body = (await request.json()) as { url?: string; entityType?: number; requestType?: number }
  if (!body.url || body.entityType === undefined || body.requestType === undefined) {
    return NextResponse.json({ message: ["url, entityType, and requestType are required"] }, { status: 422 })
  }

  try {
    await removeBlockedUrl(bing.apiKey, bing.siteUrl, { url: body.url, entityType: body.entityType, requestType: body.requestType })
    await recordActivity({
      actor: access.session!.user,
      action: "deleted",
      entityType: "bing_site_settings",
      entityId: null,
      entityLabel: "Bing Webmaster site settings",
      summary: `Unblocked ${body.url} on Bing`,
    })
    const items = await getBlockedUrls(bing.apiKey, bing.siteUrl)
    return NextResponse.json({ data: { status: "ok", reason: null, items } satisfies ListResponse, message: "URL unblocked" })
  } catch (err) {
    const message = err instanceof BingApiError || err instanceof Error ? err.message : "Could not reach Bing Webmaster Tools."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
