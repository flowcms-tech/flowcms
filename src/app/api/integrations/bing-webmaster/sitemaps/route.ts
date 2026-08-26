import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getBingConfig } from "@/Framework/Settings/SettingsService"
import { getFeeds, submitFeed, removeFeed } from "@/Framework/Integrations/BingWebmaster/sitemaps"
import { BingApiError } from "@/Framework/Integrations/BingWebmaster/client"
import type { BingFeed } from "@/Framework/Integrations/BingWebmaster/sitemaps"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

export interface BingSitemapsSummary {
  status: "ok" | "not_connected"
  reason: string | null
  siteUrl: string
  feeds: BingFeed[]
}

const feedUrlSchema = z.object({
  feedUrl: z.string().min(1, "A sitemap URL is required").max(1000),
})

function empty(status: BingSitemapsSummary["status"], reason: string | null): BingSitemapsSummary {
  return { status, reason, siteUrl: "", feeds: [] }
}

/** Not cached, per the design doc — Sitemaps is cheap, low-quota, and
 *  config-shaped; always show current truth (same reasoning GSC's Sitemaps
 *  screen already uses). */
async function resolveConnection() {
  const bing = await getBingConfig()
  if (!bing.apiKey) {
    return {
      ok: false as const,
      response: empty("not_connected", "Bing Webmaster Tools is not connected. Connect it under Settings → Integrations."),
    }
  }
  if (!bing.siteUrl) {
    return {
      ok: false as const,
      response: empty("not_connected", "Bing Webmaster Tools is connected but no site is selected. Pick one under Settings → Integrations."),
    }
  }
  return { ok: true as const, apiKey: bing.apiKey, siteUrl: bing.siteUrl }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const connection = await resolveConnection()
  if (!connection.ok) {
    return NextResponse.json({ data: connection.response, message: "Bing Webmaster Tools is not connected" })
  }

  try {
    const feeds = await getFeeds(connection.apiKey, connection.siteUrl)
    const data: BingSitemapsSummary = { status: "ok", reason: null, siteUrl: connection.siteUrl, feeds }
    return NextResponse.json({ data, message: "Sitemaps loaded" })
  } catch (err) {
    const message = err instanceof BingApiError || err instanceof Error ? err.message : "Could not reach Bing Webmaster Tools."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const parsed = feedUrlSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues.map((issue) => issue.message) }, { status: 422 })
  }

  const connection = await resolveConnection()
  if (!connection.ok) {
    return NextResponse.json({ message: connection.response.reason ?? "Bing Webmaster Tools is not connected" }, { status: 422 })
  }

  try {
    await submitFeed(connection.apiKey, connection.siteUrl, parsed.data.feedUrl)
    const feeds = await getFeeds(connection.apiKey, connection.siteUrl)
    const data: BingSitemapsSummary = { status: "ok", reason: null, siteUrl: connection.siteUrl, feeds }

    await recordActivity({
      actor: session.user,
      action: "created",
      entityType: "bing_sitemap",
      entityId: null,
      entityLabel: parsed.data.feedUrl,
      summary: `Submitted ${parsed.data.feedUrl} to Bing Webmaster Tools`,
    })

    return NextResponse.json({ data, message: "Sitemap submitted" })
  } catch (err) {
    const message = err instanceof BingApiError || err instanceof Error ? err.message : "Could not submit the sitemap to Bing."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}

export async function DELETE(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const parsed = feedUrlSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues.map((issue) => issue.message) }, { status: 422 })
  }

  const connection = await resolveConnection()
  if (!connection.ok) {
    return NextResponse.json({ message: connection.response.reason ?? "Bing Webmaster Tools is not connected" }, { status: 422 })
  }

  try {
    await removeFeed(connection.apiKey, connection.siteUrl, parsed.data.feedUrl)
    const feeds = await getFeeds(connection.apiKey, connection.siteUrl)
    const data: BingSitemapsSummary = { status: "ok", reason: null, siteUrl: connection.siteUrl, feeds }

    await recordActivity({
      actor: session.user,
      action: "deleted",
      entityType: "bing_sitemap",
      entityId: null,
      entityLabel: parsed.data.feedUrl,
      summary: `Removed ${parsed.data.feedUrl} from Bing Webmaster Tools`,
    })

    return NextResponse.json({ data, message: "Sitemap removed" })
  } catch (err) {
    const message = err instanceof BingApiError || err instanceof Error ? err.message : "Could not remove the sitemap from Bing."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
