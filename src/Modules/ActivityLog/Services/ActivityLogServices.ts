import BAPI from '@/Framework/API_Layer'
import type { ActivityListParams, ActivityListResponse } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

export const ActivityLogServices = {
  /** Read-only by design — there is no create/update/delete counterpart, and
   *  the route offers none. See the note on `/api/activity-log`. */
  async list(params: ActivityListParams): Promise<ActivityListResponse> {
    const res = await BAPI.get<ApiResponse<ActivityListResponse>>('/api/activity-log', {
      params,
      showGlobalError: true,
      showGlobalSuccess: false,
    })
    return res.data
  },
}
