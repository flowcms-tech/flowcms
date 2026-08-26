import { NextRequest, NextResponse } from "next/server"
import { getBingConfig } from "@/Framework/Settings/SettingsService"
import { getCrawlStats, getCrawlIssues, getCrawlSettings, saveCrawlSettings } from "@/Framework/Integrations/BingWebmaster/crawl"
import { BingApiError } from "@/Framework/Integrations/BingWebmaster/client"
import { CacheService } from "@/Framework/Redis/CacheService"
import { canManageSettings, resolveRole } from "@/Framework/Auth/permissions"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

const CACHE_TTL_SECONDS = 24 * 60 * 60

interface CrawlSummary {
  status: "ok" | "not_connected"
  reason: string | null
  stats: Awaited<ReturnType<typeof getCrawlStats>>
  issues: Awaited<ReturnType<typeof getCrawlIssues>>
  settings: Awaited<ReturnType<typeof getCrawlSettings>> | null
}

function empty(reason: string): CrawlSummary {
  return { status: "not_connected", reason, stats: [], issues: [], settings: null }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const bing = await getBingConfig()
  if (!bing.apiKey) {
    return NextResponse.json({
      data: empty("Bing Webmaster Tools is not connected. Connect it under Settings → Integrations."),
      message: "Not connected",
    })
  }
  if (!bing.siteUrl) {
    return NextResponse.json({
      data: empty("Bing Webmaster Tools is connected but no site is selected. Pick one under Settings → Integrations."),
      message: "Not connected",
    })
  }

  const apiKey = bing.apiKey
  const siteUrl = bing.siteUrl
  const cacheKey = `bing:crawl:${siteUrl}`

  try {
    const [{ stats, issues }, settings] = await Promise.all([
      CacheService.remember(cacheKey, CACHE_TTL_SECONDS, async () => {
        const [stats, issues] = await Promise.all([
          getCrawlStats(apiKey, siteUrl),
          getCrawlIssues(apiKey, siteUrl),
        ])
        return { stats, issues }
      }),
      // Config-shaped, not cached — always show the current truth.
      getCrawlSettings(apiKey, siteUrl),
    ])

    const data: CrawlSummary = { status: "ok", reason: null, stats, issues, settings }
    return NextResponse.json({ data, message: "Crawl data loaded" })
  } catch (err) {
    const message = err instanceof BingApiError || err instanceof Error
      ? err.message
      : "Could not reach Bing Webmaster Tools."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}

export async function PATCH(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate
  if (!canManageSettings(resolveRole(session.user.role))) {
    return NextResponse.json(
      { message: "Only an owner or admin can change crawl settings" },
      { status: 403 }
    )
  }

  const bing = await getBingConfig()
  if (!bing.apiKey || !bing.siteUrl) {
    return NextResponse.json(
      { message: "Connect Bing Webmaster Tools under Settings → Integrations first." },
      { status: 422 }
    )
  }

  const body = (await request.json()) as { crawlRate?: unknown }
  if (
    !Array.isArray(body.crawlRate) ||
    body.crawlRate.length !== 24 ||
    !body.crawlRate.every((value) => typeof value === "number" && Number.isFinite(value))
  ) {
    return NextResponse.json(
      { message: ["Crawl rate must be 24 numbers, one per hour of the day."] },
      { status: 422 }
    )
  }

  try {
    await saveCrawlSettings(bing.apiKey, bing.siteUrl, { crawlRate: body.crawlRate as number[] })
    await CacheService.del(`bing:crawl:${bing.siteUrl}`)

    await recordActivity({
      actor: session.user,
      action: "updated",
      entityType: "settings",
      entityId: null,
      entityLabel: "Bing Webmaster crawl settings",
      summary: `Updated Bing Webmaster crawl rate for ${bing.siteUrl}`,
      metadata: { siteUrl: bing.siteUrl },
    })

    const [{ stats, issues }, settings] = await Promise.all([
      CacheService.remember(`bing:crawl:${bing.siteUrl}`, CACHE_TTL_SECONDS, async () => {
        const [stats, issues] = await Promise.all([
          getCrawlStats(bing.apiKey as string, bing.siteUrl as string),
          getCrawlIssues(bing.apiKey as string, bing.siteUrl as string),
        ])
        return { stats, issues }
      }),
      getCrawlSettings(bing.apiKey, bing.siteUrl),
    ])

    const data: CrawlSummary = { status: "ok", reason: null, stats, issues, settings }
    return NextResponse.json({ data, message: "Crawl settings updated" })
  } catch (err) {
    const message = err instanceof BingApiError || err instanceof Error
      ? err.message
      : "Could not reach Bing Webmaster Tools."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
