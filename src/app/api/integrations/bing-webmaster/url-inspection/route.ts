import { NextRequest, NextResponse } from "next/server"
import { getBingConfig } from "@/Framework/Settings/SettingsService"
import {
  getUrlInfo,
  getUrlTrafficInfo,
  getChildrenUrlInfo,
  getChildrenUrlTrafficInfo,
} from "@/Framework/Integrations/BingWebmaster/urlInspection"
import { CacheService } from "@/Framework/Redis/CacheService"
import type { BingUrlInspectionResult, BingUrlProfile } from "@/Modules/BingWebmaster/Types/urlInspection"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

const CACHE_TTL_SECONDS = 24 * 60 * 60

function empty(status: BingUrlInspectionResult["status"], reason: string | null, siteUrl: string, lookupUrl: string): BingUrlInspectionResult {
  return { status, reason, siteUrl, lookupUrl, kind: null, page: null, children: [] }
}

async function inspect(apiKey: string, siteUrl: string, lookupUrl: string): Promise<BingUrlInspectionResult> {
  // Bing's own documented pattern (see GetChildrenUrlInfo's example): call
  // GetUrlInfo first and branch on `isPage` — a container has
  // `isPage: false` and a `totalChildUrlCount` — rather than guessing from
  // the URL string's shape (trailing slash, file extension), which is
  // unreliable for extensionless page paths like "/blog/some-post".
  const info = await getUrlInfo(apiKey, siteUrl, lookupUrl)

  if (info.isPage) {
    const traffic = await getUrlTrafficInfo(apiKey, siteUrl, lookupUrl)
    const page: BingUrlProfile = {
      url: info.url,
      isPage: info.isPage,
      anchorCount: info.anchorCount,
      documentSize: info.documentSize,
      httpStatus: info.httpStatus,
      totalChildUrlCount: info.totalChildUrlCount,
      discoveryDate: info.discoveryDate,
      lastCrawledDate: info.lastCrawledDate,
      clicks: traffic.clicks,
      impressions: traffic.impressions,
    }
    return { status: "ok", reason: null, siteUrl, lookupUrl, kind: "page", page, children: [] }
  }

  const [childrenInfo, childrenTraffic] = await Promise.all([
    getChildrenUrlInfo(apiKey, siteUrl, lookupUrl),
    getChildrenUrlTrafficInfo(apiKey, siteUrl, lookupUrl),
  ])
  const trafficByUrl = new Map(childrenTraffic.map((row) => [row.url, row]))
  const children: BingUrlProfile[] = childrenInfo.map((child) => {
    const traffic = trafficByUrl.get(child.url)
    return {
      url: child.url,
      isPage: child.isPage,
      anchorCount: child.anchorCount,
      documentSize: child.documentSize,
      httpStatus: child.httpStatus,
      totalChildUrlCount: child.totalChildUrlCount,
      discoveryDate: child.discoveryDate,
      lastCrawledDate: child.lastCrawledDate,
      clicks: traffic?.clicks ?? null,
      impressions: traffic?.impressions ?? null,
    }
  })

  return { status: "ok", reason: null, siteUrl, lookupUrl, kind: "directory", page: null, children }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const lookupUrl = request.nextUrl.searchParams.get("url")?.trim() || ""
  if (!lookupUrl) {
    return NextResponse.json({ data: empty("empty", null, "", ""), message: "No URL provided" })
  }

  const bing = await getBingConfig()
  if (!bing.apiKey || !bing.siteUrl) {
    return NextResponse.json({
      data: empty(
        "not_connected",
        "Bing Webmaster Tools is not connected. Connect it under Settings → Integrations.",
        "",
        lookupUrl
      ),
      message: "Not connected",
    })
  }

  try {
    const data = await CacheService.remember(
      `bing:url-inspection:${bing.siteUrl}:${lookupUrl}`,
      CACHE_TTL_SECONDS,
      () => inspect(bing.apiKey as string, bing.siteUrl as string, lookupUrl)
    )
    return NextResponse.json({ data, message: "URL inspection loaded" })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach Bing Webmaster Tools."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
