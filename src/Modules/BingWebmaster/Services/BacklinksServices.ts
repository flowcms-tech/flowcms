import BAPI from '@/Framework/API_Layer'
import type { BingBacklinksSummary, BingUrlLinksDetail } from '../Types/backlinks'

interface ApiResponse<T> { data: T; message: string | string[] }

export const BacklinksServices = {
  async backlinks(): Promise<BingBacklinksSummary> {
    const res = await BAPI.get<ApiResponse<BingBacklinksSummary>>(
      '/api/integrations/bing-webmaster/backlinks',
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async urlLinks(url: string, page = 0): Promise<BingUrlLinksDetail> {
    const res = await BAPI.get<ApiResponse<BingUrlLinksDetail>>(
      '/api/integrations/bing-webmaster/backlinks',
      { params: { url, page }, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },
}
