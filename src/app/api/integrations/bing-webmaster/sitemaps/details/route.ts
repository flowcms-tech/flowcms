import { NextRequest, NextResponse } from "next/server"
import { getBingConfig } from "@/Framework/Settings/SettingsService"
import { getFeedDetails } from "@/Framework/Integrations/BingWebmaster/sitemaps"
import { BingApiError } from "@/Framework/Integrations/BingWebmaster/client"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/** Only meaningful for a sitemap index — expands it into its child feeds.
 *  Split from the main sitemaps route since it's a per-row, on-demand
 *  lookup, not part of the list payload. */
export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const feedUrl = request.nextUrl.searchParams.get("feedUrl")
  if (!feedUrl) {
    return NextResponse.json({ message: "feedUrl is required" }, { status: 422 })
  }

  const bing = await getBingConfig()
  if (!bing.apiKey || !bing.siteUrl) {
    return NextResponse.json({ data: [], message: "Bing Webmaster Tools is not connected" })
  }

  try {
    const data = await getFeedDetails(bing.apiKey, bing.siteUrl, feedUrl)
    return NextResponse.json({ data, message: "Feed details loaded" })
  } catch (err) {
    const message = err instanceof BingApiError || err instanceof Error ? err.message : "Could not reach Bing Webmaster Tools."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
