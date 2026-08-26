import { NextRequest, NextResponse } from "next/server"
import { getBingConfig } from "@/Framework/Settings/SettingsService"
import {
  getQueryParameters,
  addQueryParameter,
  removeQueryParameter,
  enableDisableQueryParameter,
  type QueryParameter,
} from "@/Framework/Integrations/BingWebmaster/siteSettings"
import { BingApiError } from "@/Framework/Integrations/BingWebmaster/client"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

interface ListResponse {
  status: "ok" | "not_connected"
  reason: string | null
  items: QueryParameter[]
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
    const items = await getQueryParameters(bing.apiKey, bing.siteUrl)
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

  const body = (await request.json()) as { queryParameter?: string }
  if (!body.queryParameter) {
    return NextResponse.json({ message: ["queryParameter is required"] }, { status: 422 })
  }

  try {
    await addQueryParameter(bing.apiKey, bing.siteUrl, body.queryParameter)
    await recordActivity({
      actor: access.session!.user,
      action: "created",
      entityType: "bing_site_settings",
      entityId: null,
      entityLabel: "Bing Webmaster site settings",
      summary: `Added query parameter "${body.queryParameter}" to Bing normalization`,
    })
    const items = await getQueryParameters(bing.apiKey, bing.siteUrl)
    return NextResponse.json({ data: { status: "ok", reason: null, items } satisfies ListResponse, message: "Query parameter added" })
  } catch (err) {
    return NextResponse.json({ message: [errorMessage(err)] }, { status: 422 })
  }
}

export async function PATCH(request: NextRequest) {
  const access = await requireAccess(request)
  if (access.error) return access.error

  const bing = await getBingConfig()
  if (!bing.apiKey || !bing.siteUrl) {
    return NextResponse.json({ message: "Bing Webmaster Tools is not connected." }, { status: 422 })
  }

  const body = (await request.json()) as { queryParameter?: string; isEnabled?: boolean }
  if (!body.queryParameter || body.isEnabled === undefined) {
    return NextResponse.json({ message: ["queryParameter and isEnabled are required"] }, { status: 422 })
  }

  try {
    await enableDisableQueryParameter(bing.apiKey, bing.siteUrl, body.queryParameter, body.isEnabled)
    await recordActivity({
      actor: access.session!.user,
      action: "updated",
      entityType: "bing_site_settings",
      entityId: null,
      entityLabel: "Bing Webmaster site settings",
      summary: `${body.isEnabled ? "Enabled" : "Disabled"} query parameter "${body.queryParameter}" on Bing`,
    })
    const items = await getQueryParameters(bing.apiKey, bing.siteUrl)
    return NextResponse.json({ data: { status: "ok", reason: null, items } satisfies ListResponse, message: "Query parameter updated" })
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

  const body = (await request.json()) as { queryParameter?: string }
  if (!body.queryParameter) {
    return NextResponse.json({ message: ["queryParameter is required"] }, { status: 422 })
  }

  try {
    await removeQueryParameter(bing.apiKey, bing.siteUrl, body.queryParameter)
    await recordActivity({
      actor: access.session!.user,
      action: "deleted",
      entityType: "bing_site_settings",
      entityId: null,
      entityLabel: "Bing Webmaster site settings",
      summary: `Removed query parameter "${body.queryParameter}" from Bing normalization`,
    })
    const items = await getQueryParameters(bing.apiKey, bing.siteUrl)
    return NextResponse.json({ data: { status: "ok", reason: null, items } satisfies ListResponse, message: "Query parameter removed" })
  } catch (err) {
    return NextResponse.json({ message: [errorMessage(err)] }, { status: 422 })
  }
}
