import BAPI from '@/Framework/API_Layer'
import type { BingTrafficSummary, BingDetailedQueryStat } from '../Types/traffic'

interface ApiResponse<T> { data: T; message: string | string[] }

export const TrafficServices = {
  async traffic(): Promise<BingTrafficSummary> {
    const res = await BAPI.get<ApiResponse<BingTrafficSummary>>(
      '/api/integrations/bing-webmaster/traffic',
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async queryPageDetail(query: string, page: string): Promise<BingDetailedQueryStat[]> {
    const res = await BAPI.get<ApiResponse<BingDetailedQueryStat[]>>(
      '/api/integrations/bing-webmaster/traffic',
      { params: { query, page }, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },
}
