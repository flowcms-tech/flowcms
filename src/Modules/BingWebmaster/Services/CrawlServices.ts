import BAPI from '@/Framework/API_Layer'
import type { BingCrawlSummary, UpdateCrawlSettingsPayload } from '../Types/crawl'

interface ApiResponse<T> { data: T; message: string | string[] }

export const CrawlServices = {
  async crawl(): Promise<BingCrawlSummary> {
    const res = await BAPI.get<ApiResponse<BingCrawlSummary>>(
      '/api/integrations/bing-webmaster/crawl',
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async updateCrawlSettings(payload: UpdateCrawlSettingsPayload): Promise<BingCrawlSummary> {
    const res = await BAPI.patch<ApiResponse<BingCrawlSummary>>(
      '/api/integrations/bing-webmaster/crawl',
      payload,
      { showGlobalError: false, showGlobalSuccess: true }
    )
    return res.data
  },
}
