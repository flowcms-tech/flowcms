import { NextRequest, NextResponse } from "next/server"
import { getBingConfig } from "@/Framework/Settings/SettingsService"
import { getLinkCounts, getUrlLinks, getConnectedPages } from "@/Framework/Integrations/BingWebmaster/backlinks"
import { CacheService } from "@/Framework/Redis/CacheService"
import type { BingBacklinksSummary, BingUrlLinksDetail } from "@/Modules/BingWebmaster/Types/backlinks"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

const CACHE_TTL_SECONDS = 24 * 60 * 60

function emptyBacklinksSummary(reason: string): BingBacklinksSummary {
  return { status: "not_connected", reason, siteUrl: "", links: [], totalPages: 0, connectedPages: [] }
}

async function getBacklinksSummary(): Promise<BingBacklinksSummary> {
  const bing = await getBingConfig()

  // Not a 422: the request is valid, the integration just isn't set up yet —
  // the route surfaces this as a normal 200 so the screen can render a
  // "connect it" message instead of a red toast.
  if (!bing.apiKey) {
    return emptyBacklinksSummary("Bing Webmaster Tools is not connected. Connect it under Settings → Integrations.")
  }
  if (!bing.siteUrl) {
    return emptyBacklinksSummary(
      "Bing Webmaster Tools is connected but no site is selected. Pick one under Settings → Integrations."
    )
  }

  const apiKey = bing.apiKey
  const siteUrl = bing.siteUrl
  const cacheKey = `bing:backlinks:${siteUrl}`

  return CacheService.remember<BingBacklinksSummary>(cacheKey, CACHE_TTL_SECONDS, async () => {
    const [linkCounts, connectedPages] = await Promise.all([
      getLinkCounts(apiKey, siteUrl, 0),
      getConnectedPages(apiKey, siteUrl),
    ])
    return {
      status: "ok",
      reason: null,
      siteUrl,
      links: linkCounts.links.map((l) => ({ url: l.url, count: l.count })),
      totalPages: linkCounts.totalPages,
      connectedPages: connectedPages.map((p) => ({ url: p.url })),
    }
  })
}

async function getUrlLinksDetail(url: string, page: number): Promise<BingUrlLinksDetail> {
  const bing = await getBingConfig()
  if (!bing.apiKey || !bing.siteUrl) {
    return { status: "not_connected", reason: "Bing Webmaster Tools is not connected.", url, details: [], totalPages: 0 }
  }

  // Deliberately not cached — the design doc calls this an on-demand detail
  // call, separate from the summary's cached payload, since fetching every
  // page's link detail up front is wasted work for a site with many linked
  // pages.
  const detail = await getUrlLinks(bing.apiKey, bing.siteUrl, url, page)
  return { status: "ok", reason: null, url, details: detail.details, totalPages: detail.totalPages }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const url = request.nextUrl.searchParams.get("url")
  const pageParam = request.nextUrl.searchParams.get("page")
  const page = pageParam ? Number(pageParam) : 0

  try {
    if (url) {
      const data = await getUrlLinksDetail(url, page)
      return NextResponse.json({ data, message: "Inbound links loaded" })
    }

    const data = await getBacklinksSummary()
    if (data.status === "not_connected") {
      return NextResponse.json({ data, message: data.reason ?? "Bing Webmaster Tools is not connected" })
    }
    return NextResponse.json({ data, message: "Backlinks loaded" })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach Bing Webmaster Tools."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
