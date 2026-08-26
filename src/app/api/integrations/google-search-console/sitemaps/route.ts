import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getGscConfig, getGscRedirectUri } from "@/Framework/Settings/SettingsService"
import { listSitemaps, submitSitemapPath, deleteSitemap } from "@/Framework/Integrations/GoogleSearchConsole"
import type { GscSitemapsSummary } from "@/Modules/SearchConsole/Types"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

const feedpathSchema = z.object({
  path: z.string().min(1, "A sitemap path is required").max(500),
})

function empty(status: GscSitemapsSummary["status"], reason: string | null, siteUrl: string): GscSitemapsSummary {
  return { status, reason, siteUrl, sitemaps: [] }
}

async function resolveConnection() {
  const gsc = await getGscConfig()
  if (!gsc.clientId || !gsc.clientSecret || !gsc.refreshToken) {
    return { ok: false as const, response: empty("not_connected", "Search Console is not connected. Connect it under Settings → Integrations.", "") }
  }
  if (!gsc.siteUrl) {
    return { ok: false as const, response: empty("not_connected", "Search Console is connected but no property is selected. Pick one under Settings → Integrations.", "") }
  }
  const redirectUri = await getGscRedirectUri()
  return {
    ok: true as const,
    siteUrl: gsc.siteUrl,
    refreshToken: gsc.refreshToken,
    credentials: { clientId: gsc.clientId, clientSecret: gsc.clientSecret, redirectUri },
  }
}

/** Resolves a sitemap path the admin typed (bare or absolute) into the full
 *  feed URL Google's API expects — the same shape PublishHooks already
 *  submits, so a hand-typed "/sitemap-index.xml" behaves identically to the
 *  automatic one. */
function resolveFeedpath(siteUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const base = siteUrl.startsWith("sc-domain:") ? `https://${siteUrl.slice("sc-domain:".length)}` : siteUrl.replace(/\/$/, "")
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`
}

/** Shared with the Action Feed route, which needs this same summary
 *  in-process rather than making its own HTTP round trip. */
export async function getSitemapsSummary(): Promise<GscSitemapsSummary> {
  const connection = await resolveConnection()
  if (!connection.ok) return connection.response

  const sitemaps = await listSitemaps(connection.credentials, connection.refreshToken, connection.siteUrl)
  return { status: "ok", reason: null, siteUrl: connection.siteUrl, sitemaps }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  try {
    const data = await getSitemapsSummary()
    if (data.status !== "ok") {
      return NextResponse.json({ data, message: "Search Console is not connected" })
    }
    return NextResponse.json({ data, message: "Sitemaps loaded" })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach Google Search Console."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const parsed = feedpathSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues.map((issue) => issue.message) }, { status: 422 })
  }

  const connection = await resolveConnection()
  if (!connection.ok) {
    return NextResponse.json({ message: connection.response.reason ?? "Search Console is not connected" }, { status: 422 })
  }

  try {
    const feedpath = resolveFeedpath(connection.siteUrl, parsed.data.path)
    await submitSitemapPath(connection.credentials, connection.refreshToken, connection.siteUrl, feedpath)
    const sitemaps = await listSitemaps(connection.credentials, connection.refreshToken, connection.siteUrl)
    const data: GscSitemapsSummary = { status: "ok", reason: null, siteUrl: connection.siteUrl, sitemaps }
    return NextResponse.json({ data, message: "Sitemap submitted" })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not submit the sitemap to Google."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}

export async function DELETE(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const parsed = feedpathSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues.map((issue) => issue.message) }, { status: 422 })
  }

  const connection = await resolveConnection()
  if (!connection.ok) {
    return NextResponse.json({ message: connection.response.reason ?? "Search Console is not connected" }, { status: 422 })
  }

  try {
    await deleteSitemap(connection.credentials, connection.refreshToken, connection.siteUrl, parsed.data.path)
    const sitemaps = await listSitemaps(connection.credentials, connection.refreshToken, connection.siteUrl)
    const data: GscSitemapsSummary = { status: "ok", reason: null, siteUrl: connection.siteUrl, sitemaps }
    return NextResponse.json({ data, message: "Sitemap deleted" })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not delete the sitemap from Google."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
