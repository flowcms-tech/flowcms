/**
 * Shapes shared by the Search Console page-performance route and the Insights
 * tab.
 *
 * A separate file from `Types/index.ts` on purpose: that barrel is the post
 * CRUD contract and is edited by every wave that touches the post form, and
 * these types belong to a read-only measurement panel that has nothing to do
 * with saving a post.
 */

export interface InsightsTotals {
  clicks: number
  impressions: number
  /** 0–1, as Google reports it. */
  ctr: number
  /** 1-based, impression-weighted. */
  position: number
}

export interface InsightsDayPoint {
  /** YYYY-MM-DD. */
  date: string
  clicks: number
  impressions: number
}

export interface InsightsQueryRow extends Record<string, unknown> {
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

/**
 * Why a discriminator instead of an empty array plus a 422:
 *
 * "GSC is not connected", "this post is too new for Google to have data yet",
 * and "this post genuinely gets zero impressions" all render as an empty panel,
 * and they need completely different responses from the editor — connect the
 * integration, wait, or rewrite the post. Collapsing them into one empty state
 * makes the panel useless in exactly the case it is meant to help with.
 *
 * `too_new` is decided by the client, which knows the post's publish date; the
 * route only reports whether Google returned rows.
 */
export type InsightsStatus = "ok" | "not_connected" | "no_data"

export interface PagePerformance {
  status: InsightsStatus
  /** Populated for `not_connected` — says which half of the setup is missing. */
  reason: string | null
  /** The absolute URL the query was actually run against, so the panel can show
   *  it. A silent mismatch between this and the property's canonical form is the
   *  usual cause of "GSC says zero but the post ranks". */
  pageUrl: string
  /** Inclusive YYYY-MM-DD bounds, ending at the freshest date Google is likely
   *  to have finalised rather than at today. */
  startDate: string
  endDate: string
  /** How many days behind today `endDate` sits. Shown in the UI so a blank
   *  panel on a two-day-old post reads as "not yet", not "failed". */
  lagDays: number
  totals: InsightsTotals
  series: InsightsDayPoint[]
  queries: InsightsQueryRow[]
}
