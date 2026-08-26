import { NextRequest, NextResponse } from "next/server"
import { getBingConfig } from "@/Framework/Settings/SettingsService"
import { getSiteMoves, submitSiteMove, type SiteMove } from "@/Framework/Integrations/BingWebmaster/siteSettings"
import { BingApiError } from "@/Framework/Integrations/BingWebmaster/client"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

interface ListResponse {
  status: "ok" | "not_connected"
  reason: string | null
  items: SiteMove[]
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
    const items = await getSiteMoves(bing.apiKey, bing.siteUrl)
    return NextResponse.json({ data: { status: "ok", reason: null, items } satisfies ListResponse, message: "Loaded" })
  } catch (err) {
    return NextResponse.json({ message: [errorMessage(err)] }, { status: 422 })
  }
}

/**
 * A real, consequential account action — Bing's own docs give no undo path.
 * The module gates this behind an explicit danger-variant confirm modal;
 * this route does not add a second guard beyond the existing auth/role
 * check, since role-gating is the correct enforcement layer, not a second
 * confirmation prompt server-side.
 */
export async function POST(request: NextRequest) {
  const access = await requireAccess(request)
  if (access.error) return access.error

  const bing = await getBingConfig()
  if (!bing.apiKey || !bing.siteUrl) {
    return NextResponse.json({ message: "Bing Webmaster Tools is not connected." }, { status: 422 })
  }

  const body = (await request.json()) as { moveScope?: number; moveType?: number; sourceUrl?: string; targetUrl?: string }
  if (body.moveScope === undefined || body.moveType === undefined || !body.sourceUrl || !body.targetUrl) {
    return NextResponse.json({ message: ["moveScope, moveType, sourceUrl, and targetUrl are required"] }, { status: 422 })
  }

  try {
    await submitSiteMove(bing.apiKey, bing.siteUrl, {
      moveScope: body.moveScope,
      moveType: body.moveType,
      sourceUrl: body.sourceUrl,
      targetUrl: body.targetUrl,
    })
    await recordActivity({
      actor: access.session!.user,
      action: "created",
      entityType: "bing_site_settings",
      entityId: null,
      entityLabel: "Bing Webmaster site settings",
      summary: `Submitted a site move from ${body.sourceUrl} to ${body.targetUrl} on Bing`,
    })
    const items = await getSiteMoves(bing.apiKey, bing.siteUrl)
    return NextResponse.json({ data: { status: "ok", reason: null, items } satisfies ListResponse, message: "Site move submitted" })
  } catch (err) {
    return NextResponse.json({ message: [errorMessage(err)] }, { status: 422 })
  }
}
