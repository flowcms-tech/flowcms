import BAPI from '@/Framework/API_Layer'
import type { BingUrlInspectionResult } from '../Types/urlInspection'

interface ApiResponse<T> { data: T; message: string | string[] }

export const UrlInspectionServices = {
  async inspect(url: string): Promise<BingUrlInspectionResult> {
    const res = await BAPI.get<ApiResponse<BingUrlInspectionResult>>(
      '/api/integrations/bing-webmaster/url-inspection',
      { params: { url }, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },
}
