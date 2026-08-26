import { NextRequest, NextResponse } from "next/server"
import { getBingConfig } from "@/Framework/Settings/SettingsService"
import {
  getUrlSubmissionQuota,
  getContentSubmissionQuota,
  getFetchedUrls,
  submitUrl,
  submitUrlBatch,
  submitContent,
  fetchUrl,
  URL_SUBMISSION_BATCH_LIMIT,
  type UrlSubmissionQuota,
  type ContentSubmissionQuota,
  type FetchedUrl,
  type SubmitContentInput,
} from "@/Framework/Integrations/BingWebmaster/urlSubmission"
import { BingApiError } from "@/Framework/Integrations/BingWebmaster/client"
import { recordActivity } from "@/db/activityLog"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

export interface BingUrlSubmissionSummary {
  status: "ok" | "not_connected"
  reason: string | null
  urlQuota: UrlSubmissionQuota | null
  contentQuota: ContentSubmissionQuota | null
  fetchedUrls: FetchedUrl[]
}

function empty(reason: string): BingUrlSubmissionSummary {
  return { status: "not_connected", reason, urlQuota: null, contentQuota: null, fetchedUrls: [] }
}

async function requireBingSite(): Promise<{ apiKey: string; siteUrl: string } | { error: BingUrlSubmissionSummary }> {
  const bing = await getBingConfig()
  if (!bing.apiKey) {
    return { error: empty("Bing Webmaster Tools is not connected. Connect it under Settings → Integrations.") }
  }
  if (!bing.siteUrl) {
    return {
      error: empty("Bing Webmaster Tools is connected but no site is selected. Pick one under Settings → Integrations."),
    }
  }
  return { apiKey: bing.apiKey, siteUrl: bing.siteUrl }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const resolved = await requireBingSite()
  if ("error" in resolved) {
    return NextResponse.json({ data: resolved.error, message: "Bing Webmaster not connected" })
  }
  const { apiKey, siteUrl } = resolved

  try {
    // Quotas and fetch history are deliberately uncached — "how much is left
    // right now" is the whole point of this screen.
    const [urlQuota, contentQuota, fetchedUrls] = await Promise.all([
      getUrlSubmissionQuota(apiKey, siteUrl),
      getContentSubmissionQuota(apiKey, siteUrl),
      getFetchedUrls(apiKey, siteUrl),
    ])

    const data: BingUrlSubmissionSummary = { status: "ok", reason: null, urlQuota, contentQuota, fetchedUrls }
    return NextResponse.json({ data, message: "URL submission data loaded" })
  } catch (err) {
    const message = err instanceof BingApiError || err instanceof Error ? err.message : "Could not reach Bing Webmaster Tools."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}

type SubmitBody =
  | { type: "single"; url: string }
  | { type: "batch"; urls: string[] }
  | { type: "content"; input: SubmitContentInput }
  | { type: "fetch"; url: string }

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function validateBody(body: unknown): { data: SubmitBody } | { errors: string[] } {
  if (!body || typeof body !== "object" || !("type" in body)) {
    return { errors: ["Missing submission type."] }
  }
  const { type } = body as { type: unknown }

  if (type === "single" || type === "fetch") {
    const url = (body as { url?: unknown }).url
    if (!isNonEmptyString(url)) return { errors: ["A URL is required."] }
    return { data: { type, url } }
  }

  if (type === "batch") {
    const urls = (body as { urls?: unknown }).urls
    if (!Array.isArray(urls) || urls.length === 0 || !urls.every(isNonEmptyString)) {
      return { errors: ["Provide at least one URL, one per line."] }
    }
    if (urls.length > URL_SUBMISSION_BATCH_LIMIT) {
      return { errors: [`A batch submission is limited to ${URL_SUBMISSION_BATCH_LIMIT} URLs at a time.`] }
    }
    return { data: { type, urls } }
  }

  if (type === "content") {
    const input = (body as { input?: unknown }).input as Partial<SubmitContentInput> | undefined
    if (
      !input ||
      !isNonEmptyString(input.url) ||
      !isNonEmptyString(input.httpMessage) ||
      typeof input.structuredData !== "string" ||
      typeof input.dynamicServing !== "number"
    ) {
      return { errors: ["URL, HTTP message, and dynamic serving are required for a content submission."] }
    }
    return { data: { type, input: input as SubmitContentInput } }
  }

  return { errors: ["Unknown submission type."] }
}

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  const resolved = await requireBingSite()
  if ("error" in resolved) {
    return NextResponse.json({ message: [resolved.error.reason ?? "Bing Webmaster not connected"] }, { status: 422 })
  }
  const { apiKey, siteUrl } = resolved

  const validated = validateBody(await request.json())
  if ("errors" in validated) {
    return NextResponse.json({ message: validated.errors }, { status: 422 })
  }
  const body = validated.data

  try {
    let summary: string
    switch (body.type) {
      case "single":
        await submitUrl(apiKey, siteUrl, body.url)
        summary = `Submitted 1 URL to Bing: ${body.url}`
        break
      case "batch":
        await submitUrlBatch(apiKey, siteUrl, body.urls)
        summary = `Submitted ${body.urls.length} URLs to Bing`
        break
      case "content":
        await submitContent(apiKey, siteUrl, body.input)
        summary = `Submitted content for ${body.input.url} to Bing`
        break
      case "fetch":
        await fetchUrl(apiKey, siteUrl, body.url)
        summary = `Fetched ${body.url} as Bingbot`
        break
    }

    await recordActivity({
      actor: session.user,
      action: "submitted",
      entityType: "bing_submission",
      entityId: null,
      entityLabel: siteUrl,
      summary,
    })

    return NextResponse.json({ data: { ok: true }, message: "Submitted to Bing Webmaster Tools" })
  } catch (err) {
    const message = err instanceof BingApiError || err instanceof Error ? err.message : "Could not reach Bing Webmaster Tools."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
