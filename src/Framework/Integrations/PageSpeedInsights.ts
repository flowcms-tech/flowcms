import "server-only"
import { google } from "googleapis"

/**
 * Core Web Vitals come from PageSpeed Insights v5, not the Search Console
 * API — Search Console has no Core Web Vitals endpoint. This is a separate
 * Google API, authenticated with a plain API key rather than the OAuth
 * client the rest of the Search Console integration uses.
 */

export type CwvCategory = "FAST" | "AVERAGE" | "SLOW" | null

export interface CwvMetric {
  /** Milliseconds for timing metrics. For CLS, Google reports the score
   *  multiplied by 100 (a CLS of 0.05 arrives as percentile 5) so it fits
   *  the same integer-percentile shape as the timing metrics — the module
   *  divides CLS by 100 for display. */
  percentile: number | null
  category: CwvCategory
}

export interface CwvResult {
  url: string
  strategy: "mobile" | "desktop"
  /** Null when Google has no field data for this URL/origin yet — a new or
   *  low-traffic page genuinely has none, which is different from an error. */
  overallCategory: string | null
  /** 0–1, from the Lighthouse lab run — always present since it's computed
   *  fresh, unlike the field-data metrics below. */
  performanceScore: number | null
  metrics: {
    lcp: CwvMetric
    cls: CwvMetric
    inp: CwvMetric
    fcp: CwvMetric
  }
  /** Lab data (Lighthouse), always present regardless of field data. */
  labLcpMs: number | null
  labCls: number | null
  labTbtMs: number | null
}

function toMetric(raw: { percentile?: number | null; category?: string | null } | undefined): CwvMetric {
  return {
    percentile: raw?.percentile ?? null,
    category: (raw?.category as CwvCategory) ?? null,
  }
}

export async function runPageSpeed(
  apiKey: string,
  url: string,
  strategy: "mobile" | "desktop"
): Promise<CwvResult> {
  const pagespeedonline = google.pagespeedonline({ version: "v5" })
  const res = await pagespeedonline.pagespeedapi.runpagespeed({
    url,
    strategy,
    category: ["PERFORMANCE"],
    key: apiKey,
  })

  const metrics = res.data.loadingExperience?.metrics ?? {}
  const audits = res.data.lighthouseResult?.audits ?? {}

  return {
    url,
    strategy,
    overallCategory: res.data.loadingExperience?.overall_category ?? null,
    performanceScore: res.data.lighthouseResult?.categories?.performance?.score ?? null,
    metrics: {
      lcp: toMetric(metrics["LARGEST_CONTENTFUL_PAINT_MS"]),
      cls: toMetric(metrics["CUMULATIVE_LAYOUT_SHIFT_SCORE"]),
      inp: toMetric(metrics["INTERACTION_TO_NEXT_PAINT"]),
      fcp: toMetric(metrics["FIRST_CONTENTFUL_PAINT_MS"]),
    },
    labLcpMs: audits["largest-contentful-paint"]?.numericValue ?? null,
    labCls: audits["cumulative-layout-shift"]?.numericValue ?? null,
    labTbtMs: audits["total-blocking-time"]?.numericValue ?? null,
  }
}
