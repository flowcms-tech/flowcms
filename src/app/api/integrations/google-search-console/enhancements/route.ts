import { NextRequest, NextResponse } from "next/server"
import {
  getKnownPageInspections,
  mapWithConcurrency,
  INSPECTION_CONCURRENCY,
} from "@/Framework/Integrations/knownPageInspections"
import type { GscEnhancementRow, GscEnhancementsSummary } from "@/Modules/SearchConsole/Types"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * "Enhancements" derived from Rich Results, not a dedicated Google API —
 * none exists. Reuses the same per-page URL Inspection calls Page Indexing
 * makes (via the shared knownPageInspections helper, and its cache), and
 * aggregates the `richResultsResult.detectedItems` each inspection already
 * returns by rich-result type across every known page.
 */

function empty(status: GscEnhancementsSummary["status"], reason: string | null, siteUrl: string): GscEnhancementsSummary {
  return { status, reason, siteUrl, checkedAt: null, enhancements: [], totalKnownPages: 0, inspectedCount: 0 }
}

/** Shared with the Action Feed route. */
export async function getEnhancementsSummary(options: { forceRefresh?: boolean } = {}): Promise<GscEnhancementsSummary> {
  const resolved = await getKnownPageInspections({ forceRefresh: options.forceRefresh ?? false })

  if (resolved.status !== "ok") {
    return empty(resolved.status === "not_connected" ? "not_connected" : "no_pages", resolved.reason, resolved.siteUrl)
  }

  const inspections = await mapWithConcurrency(resolved.urls, INSPECTION_CONCURRENCY, async (url) => {
    try {
      const inspection = await resolved.getInspection(url)
      return { url, richResultTypes: inspection.richResultTypes, error: null as string | null }
    } catch (err) {
      return { url, richResultTypes: [], error: err instanceof Error ? err.message : "Could not inspect this URL." }
    }
  })

  const byType = new Map<string, GscEnhancementRow>()
  for (const inspection of inspections) {
    for (const detected of inspection.richResultTypes) {
      const row = byType.get(detected.type) ?? { type: detected.type, validPages: 0, invalidPages: 0, pages: [] }
      const valid = detected.invalidCount === 0
      row.validPages += valid ? 1 : 0
      row.invalidPages += valid ? 0 : 1
      row.pages.push({ url: inspection.url, valid })
      byType.set(detected.type, row)
    }
  }

  const enhancements = Array.from(byType.values()).sort(
    (a, b) => b.validPages + b.invalidPages - (a.validPages + a.invalidPages)
  )

  return {
    status: "ok",
    reason: null,
    siteUrl: resolved.siteUrl,
    checkedAt: new Date().toISOString(),
    enhancements,
    totalKnownPages: resolved.totalKnownPages,
    inspectedCount: resolved.urls.length,
  }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1"

  try {
    const data = await getEnhancementsSummary({ forceRefresh })
    if (data.status !== "ok") {
      return NextResponse.json({ data, message: data.reason })
    }
    return NextResponse.json({ data, message: "Enhancements loaded" })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach Google Search Console."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
