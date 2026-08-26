import BAPI from '@/Framework/API_Layer'
import type { DashboardSummary } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

export const DashboardServices = {
  async summary(): Promise<DashboardSummary> {
    const res = await BAPI.get<ApiResponse<DashboardSummary>>('/api/dashboard', {
      showGlobalError: true,
      showGlobalSuccess: false,
    })
    return res.data
  },
}
