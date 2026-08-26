import type { GscUrlInspection } from '@/Framework/Integrations/GoogleSearchConsole'
import type { GscUrlInspectionRow } from '../Types'

/** Shared by both the bulk page-indexing route and the ad-hoc single-URL
 *  route, so a URL inspected through either path renders identically. */
export function toUrlInspectionRow(url: string, result: GscUrlInspection): GscUrlInspectionRow {
  return {
    url,
    indexed: result.verdict === 'PASS',
    verdict: result.verdict,
    coverageState: result.coverageState,
    robotsTxtState: result.robotsTxtState,
    indexingState: result.indexingState,
    pageFetchState: result.pageFetchState,
    lastCrawlTime: result.lastCrawlTime,
    googleCanonical: result.googleCanonical,
    userCanonical: result.userCanonical,
    canonicalMismatch: !!(result.userCanonical && result.googleCanonical && result.userCanonical !== result.googleCanonical),
    mobileUsabilityVerdict: result.mobileUsabilityVerdict,
    mobileUsabilityIssueCount: result.mobileUsabilityIssueCount,
    richResultsVerdict: result.richResultsVerdict,
    richResultsTypeCount: result.richResultsTypeCount,
    richResultTypes: result.richResultTypes,
    inspectionResultLink: result.inspectionResultLink,
    error: null,
  }
}

/** One URL's inspection call failing (rate limit, transient network blip)
 *  must not blank the whole report — it renders as its own row instead. */
export function errorInspectionRow(url: string, error: unknown): GscUrlInspectionRow {
  return {
    url,
    indexed: false,
    verdict: null,
    coverageState: null,
    robotsTxtState: null,
    indexingState: null,
    pageFetchState: null,
    lastCrawlTime: null,
    googleCanonical: null,
    userCanonical: null,
    canonicalMismatch: false,
    mobileUsabilityVerdict: null,
    mobileUsabilityIssueCount: 0,
    richResultsVerdict: null,
    richResultsTypeCount: 0,
    richResultTypes: [],
    inspectionResultLink: null,
    error: error instanceof Error ? error.message : 'Could not inspect this URL.',
  }
}
