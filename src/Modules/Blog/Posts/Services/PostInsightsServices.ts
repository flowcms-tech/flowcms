import BAPI from '@/Framework/API_Layer'
import type { PagePerformance } from '../Types/insights'

interface ApiResponse<T> { data: T; message: string | string[] }

/**
 * A separate service file from `BlogPostServices` on purpose: nothing here
 * reads or writes a post. This is the measurement side, and it talks to the
 * integrations routes.
 */
export const PostInsightsServices = {
  /**
   * `pageUrl` may be a site-relative path — the route resolves it against the
   * configured base URL. Callers should pass `/blog/<slug>` rather than
   * assembling an absolute URL from a second copy of the base URL that can
   * drift out of sync with settings.
   */
  async pagePerformance(pageUrl: string): Promise<PagePerformance> {
    const res = await BAPI.get<ApiResponse<PagePerformance>>(
      '/api/integrations/google-search-console/page-performance',
      { params: { url: pageUrl }, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },
}
