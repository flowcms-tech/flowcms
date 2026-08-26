import BAPI from '@/Framework/API_Layer'
import type { BingOverview } from '../Types/overview'

interface ApiResponse<T> { data: T; message: string | string[] }

export const OverviewServices = {
  async overview(): Promise<BingOverview> {
    const res = await BAPI.get<ApiResponse<BingOverview>>(
      '/api/integrations/bing-webmaster/overview',
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },
}
