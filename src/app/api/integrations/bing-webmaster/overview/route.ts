import { NextRequest, NextResponse } from "next/server"
import { getBingConfig } from "@/Framework/Settings/SettingsService"
import { getUserSites, type BingSite } from "@/Framework/Integrations/BingWebmaster/sites"
import {
  getUrlSubmissionQuota,
  getContentSubmissionQuota,
  type UrlSubmissionQuota,
  type ContentSubmissionQuota,
} from "@/Framework/Integrations/BingWebmaster/urlSubmission"
import { BingApiError } from "@/Framework/Integrations/BingWebmaster/client"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

export interface BingOverview {
  status: "ok" | "not_connected"
  reason: string | null
  siteUrl: string
  siteVerified: boolean
  sites: BingSite[]
  urlSubmissionQuota: UrlSubmissionQuota | null
  contentSubmissionQuota: ContentSubmissionQuota | null
}

function empty(status: BingOverview["status"], reason: string | null): BingOverview {
  return {
    status,
    reason,
    siteUrl: "",
    siteVerified: false,
    sites: [],
    urlSubmissionQuota: null,
    contentSubmissionQuota: null,
  }
}

/** Not cached — the site list and quotas are exactly the "is this still
 *  working, how much do I have left right now" numbers someone opens this
 *  screen to check, same reasoning as the URL Submission screen's quotas. */
export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const bing = await getBingConfig()
  if (!bing.apiKey) {
    return NextResponse.json({
      data: empty("not_connected", "Bing Webmaster Tools is not connected. Connect it under Settings → Integrations."),
      message: "Bing Webmaster Tools is not connected",
    })
  }
  if (!bing.siteUrl) {
    return NextResponse.json({
      data: empty("not_connected", "Bing Webmaster Tools is connected but no site is selected. Pick one under Settings → Integrations."),
      message: "Bing Webmaster Tools is not connected",
    })
  }

  const apiKey = bing.apiKey
  const siteUrl = bing.siteUrl

  try {
    const [sites, urlSubmissionQuota, contentSubmissionQuota] = await Promise.all([
      getUserSites(apiKey),
      getUrlSubmissionQuota(apiKey, siteUrl),
      getContentSubmissionQuota(apiKey, siteUrl),
    ])

    const data: BingOverview = {
      status: "ok",
      reason: null,
      siteUrl,
      siteVerified: sites.some((s) => s.url === siteUrl && s.isVerified),
      sites,
      urlSubmissionQuota,
      contentSubmissionQuota,
    }
    return NextResponse.json({ data, message: "Bing Webmaster overview loaded" })
  } catch (err) {
    const message = err instanceof BingApiError || err instanceof Error ? err.message : "Could not reach Bing Webmaster Tools."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
