import BAPI from '@/Framework/API_Layer'
import type {
  GscRangeSelection,
  GscSiteDashboard,
  GscPageIndexingSummary,
  GscUrlInspectionRow,
  GscSitemapsSummary,
  GscEnhancementsSummary,
  LinksReport,
  CwvSummary,
  CwvPageRow,
  CwvStrategy,
  ActionFeedSummary,
  PageProfile,
} from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

/**
 * Talks to the same integrations routes the per-post Insights panel uses,
 * just the site-wide variant — nothing here reads or writes a post.
 */
export const SearchConsoleServices = {
  async siteDashboard(range: GscRangeSelection): Promise<GscSiteDashboard> {
    const params = range.kind === 'preset' ? { days: range.days } : { from: range.startDate, to: range.endDate }
    const res = await BAPI.get<ApiResponse<GscSiteDashboard>>(
      '/api/integrations/google-search-console/site-performance',
      { params, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async pageIndexing(refresh = false): Promise<GscPageIndexingSummary> {
    const res = await BAPI.get<ApiResponse<GscPageIndexingSummary>>(
      '/api/integrations/google-search-console/page-indexing',
      { params: refresh ? { refresh: 1 } : undefined, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  /** `url` may be a site-relative path — the route resolves it against the
   *  configured base URL, same convention as the per-post Insights panel. */
  async inspectUrl(url: string): Promise<GscUrlInspectionRow> {
    const res = await BAPI.post<ApiResponse<GscUrlInspectionRow>>(
      '/api/integrations/google-search-console/inspect-url',
      { url },
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async listSitemaps(): Promise<GscSitemapsSummary> {
    const res = await BAPI.get<ApiResponse<GscSitemapsSummary>>(
      '/api/integrations/google-search-console/sitemaps',
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async submitSitemap(path: string): Promise<GscSitemapsSummary> {
    const res = await BAPI.post<ApiResponse<GscSitemapsSummary>>(
      '/api/integrations/google-search-console/sitemaps',
      { path },
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async deleteSitemap(path: string): Promise<GscSitemapsSummary> {
    const res = await BAPI.delete<ApiResponse<GscSitemapsSummary>>(
      '/api/integrations/google-search-console/sitemaps',
      { path },
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async enhancements(refresh = false): Promise<GscEnhancementsSummary> {
    const res = await BAPI.get<ApiResponse<GscEnhancementsSummary>>(
      '/api/integrations/google-search-console/enhancements',
      { params: refresh ? { refresh: 1 } : undefined, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  /** Not under /api/integrations/google-search-console/ on purpose — this
   *  data never touches Google, it's computed from this site's own post
   *  content. See LinksModule's disclaimer banner. */
  async linksReport(): Promise<LinksReport> {
    const res = await BAPI.get<ApiResponse<LinksReport>>(
      '/api/links-report',
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async coreWebVitals(strategy: CwvStrategy, refresh = false): Promise<CwvSummary> {
    const res = await BAPI.get<ApiResponse<CwvSummary>>(
      '/api/integrations/pagespeed/core-web-vitals',
      { params: { strategy, ...(refresh ? { refresh: 1 } : {}) }, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async actionFeed(): Promise<ActionFeedSummary> {
    const res = await BAPI.get<ApiResponse<ActionFeedSummary>>(
      '/api/search-console/action-feed',
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async pageProfile(params: { postId: string } | { url: string }): Promise<PageProfile> {
    const res = await BAPI.get<ApiResponse<PageProfile>>(
      '/api/search-console/page-profile',
      { params, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async testCoreWebVitals(url: string, strategy: CwvStrategy): Promise<CwvPageRow> {
    const res = await BAPI.post<ApiResponse<CwvPageRow>>(
      '/api/integrations/pagespeed/core-web-vitals',
      { url, strategy },
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },
}
