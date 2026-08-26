import BAPI from '@/Framework/API_Layer'
import type { BingSitemapsSummary, BingFeed } from '../Types/sitemaps'

interface ApiResponse<T> { data: T; message: string | string[] }

export const SitemapsServices = {
  async sitemaps(): Promise<BingSitemapsSummary> {
    const res = await BAPI.get<ApiResponse<BingSitemapsSummary>>(
      '/api/integrations/bing-webmaster/sitemaps',
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  /** Expands a sitemap index into its child feeds — lazy-loaded per row, not
   *  part of the initial list fetch. */
  async feedDetails(feedUrl: string): Promise<BingFeed[]> {
    const res = await BAPI.get<ApiResponse<BingFeed[]>>(
      '/api/integrations/bing-webmaster/sitemaps/details',
      { params: { feedUrl }, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async submitSitemap(feedUrl: string): Promise<BingSitemapsSummary> {
    const res = await BAPI.post<ApiResponse<BingSitemapsSummary>>(
      '/api/integrations/bing-webmaster/sitemaps',
      { feedUrl },
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },

  async removeSitemap(feedUrl: string): Promise<BingSitemapsSummary> {
    const res = await BAPI.delete<ApiResponse<BingSitemapsSummary>>(
      '/api/integrations/bing-webmaster/sitemaps',
      { feedUrl },
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },
}
