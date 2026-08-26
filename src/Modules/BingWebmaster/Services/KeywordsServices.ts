import BAPI from '@/Framework/API_Layer'
import type { BingKeywordsSummary } from '../Types/keywords'

interface ApiResponse<T> { data: T; message: string | string[] }

export const KeywordsServices = {
  async keywords(query: string, country?: string): Promise<BingKeywordsSummary> {
    const res = await BAPI.get<ApiResponse<BingKeywordsSummary>>(
      '/api/integrations/bing-webmaster/keywords',
      { params: { query, ...(country ? { country } : {}) }, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },
}
