import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getBaseUrl, getGscConfig, getGscRedirectUri } from "@/Framework/Settings/SettingsService"
import { inspectUrl } from "@/Framework/Integrations/GoogleSearchConsole"
import { CacheService } from "@/Framework/Redis/CacheService"
import { toUrlInspectionRow } from "@/Modules/SearchConsole/Values/inspection"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * Ad-hoc single-URL inspection — the "check any URL" box on the Page
 * Indexing screen, for spot-checking a page outside the known-posts batch
 * (an old redirected URL, a service page, a competitor's for comparison).
 *
 * Shares its cache key with the bulk page-indexing route: inspecting a URL
 * here warms the batch view for it too, and vice versa.
 */
const INSPECTION_CACHE_TTL_SECONDS = 24 * 60 * 60

const bodySchema = z.object({
  url: z.string().trim().min(1, "A URL is required."),
})

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues.map((issue) => issue.message) }, { status: 422 })
  }

  const [baseUrl, gsc] = await Promise.all([getBaseUrl(), getGscConfig()])
  if (!gsc.clientId || !gsc.clientSecret || !gsc.refreshToken || !gsc.siteUrl) {
    return NextResponse.json(
      { message: ["Search Console is not fully connected — check Settings → Integrations."] },
      { status: 422 }
    )
  }

  const raw = parsed.data.url
  const url = /^https?:\/\//i.test(raw) ? raw : `${baseUrl}${raw.startsWith("/") ? "" : "/"}${raw}`

  const siteUrl = gsc.siteUrl
  const refreshToken = gsc.refreshToken
  const redirectUri = await getGscRedirectUri()
  const credentials = { clientId: gsc.clientId, clientSecret: gsc.clientSecret, redirectUri }
  const cacheKey = `gsc:url-inspection:${siteUrl}:${url}`

  try {
    const result = await CacheService.remember(cacheKey, INSPECTION_CACHE_TTL_SECONDS, () =>
      inspectUrl(credentials, refreshToken, siteUrl, url)
    )
    return NextResponse.json({ data: toUrlInspectionRow(url, result), message: "Inspection complete" })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not inspect this URL."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
