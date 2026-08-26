import { NextRequest, NextResponse } from "next/server"
import {
  getKnownPageInspections,
  mapWithConcurrency,
  INSPECTION_CONCURRENCY,
} from "@/Framework/Integrations/knownPageInspections"
import { toUrlInspectionRow, errorInspectionRow } from "@/Modules/SearchConsole/Values/inspection"
import type { GscIndexingReasonSource, GscPageIndexingSummary, GscUrlInspectionRow } from "@/Modules/SearchConsole/Types"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"

/**
 * Live per-page indexing diagnostics.
 *
 * There is no bulk equivalent of this route to call: Google's Index
 * Coverage report (the historical chart and the 600K-style aggregate counts
 * in the Search Console UI) is not exposed by any API — only the single-URL
 * Inspection API is. This route calls that once per known published post
 * (cached — see knownPageInspections.ts) and builds the same kind of
 * "why aren't these indexed" breakdown from the results, scoped to pages
 * this app actually knows about rather than every URL Google has ever
 * crawled (which, for an established site, includes years of stale/removed
 * paths a fresh report has no use for).
 */

/** Same Website/Google-systems split the real Search Console UI draws —
 *  it's the difference between "you can fix this" and "Google decided
 *  this on its own crawl budget/schedule". Unrecognised reasons default to
 *  Website: if we don't know what it is, treating it as actionable is the
 *  safer wrong guess than telling someone there's nothing they can do. */
const GOOGLE_SYSTEMS_REASONS = new Set([
  "Crawled - currently not indexed",
  "Discovered - currently not indexed",
  "Duplicate, Google chose different canonical than user",
])

function classifySource(reason: string): GscIndexingReasonSource {
  return GOOGLE_SYSTEMS_REASONS.has(reason) ? "Google systems" : "Website"
}

function empty(status: GscPageIndexingSummary["status"], reason: string | null, siteUrl: string): GscPageIndexingSummary {
  return {
    status,
    reason,
    siteUrl,
    checkedAt: null,
    indexedCount: 0,
    notIndexedCount: 0,
    erroredCount: 0,
    reasons: [],
    pages: [],
    totalKnownPages: 0,
    inspectedCount: 0,
  }
}

/** Shared with the Action Feed route. */
export async function getPageIndexingSummary(options: { forceRefresh?: boolean } = {}): Promise<GscPageIndexingSummary> {
  const resolved = await getKnownPageInspections({ forceRefresh: options.forceRefresh ?? false })

  if (resolved.status !== "ok") {
    return empty(resolved.status === "not_connected" ? "not_connected" : "no_pages", resolved.reason, resolved.siteUrl)
  }

  const inspections = await mapWithConcurrency(resolved.urls, INSPECTION_CONCURRENCY, async (url): Promise<GscUrlInspectionRow> => {
    try {
      return toUrlInspectionRow(url, await resolved.getInspection(url))
    } catch (err) {
      return errorInspectionRow(url, err)
    }
  })

  const indexedCount = inspections.filter((row) => row.indexed).length
  const erroredCount = inspections.filter((row) => row.error).length
  const notIndexed = inspections.filter((row) => !row.indexed && !row.error)

  const reasonGroups = new Map<string, string[]>()
  for (const row of notIndexed) {
    const reason = row.coverageState ?? "Unknown"
    const list = reasonGroups.get(reason) ?? []
    list.push(row.url)
    reasonGroups.set(reason, list)
  }
  const reasons = Array.from(reasonGroups.entries())
    .map(([reason, urlList]) => ({
      reason,
      source: classifySource(reason),
      pages: urlList.length,
      urls: urlList,
    }))
    .sort((a, b) => b.pages - a.pages)

  return {
    status: "ok",
    reason: null,
    siteUrl: resolved.siteUrl,
    checkedAt: new Date().toISOString(),
    indexedCount,
    notIndexedCount: notIndexed.length,
    erroredCount,
    reasons,
    pages: inspections,
    totalKnownPages: resolved.totalKnownPages,
    inspectedCount: resolved.urls.length,
  }
}

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response

  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1"

  try {
    const data = await getPageIndexingSummary({ forceRefresh })
    if (data.status !== "ok") {
      return NextResponse.json({ data, message: data.reason })
    }
    return NextResponse.json({ data, message: "Page indexing loaded" })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach Google Search Console."
    return NextResponse.json({ message: [message] }, { status: 422 })
  }
}
