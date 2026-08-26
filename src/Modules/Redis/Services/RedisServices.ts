import BAPI from '@/Framework/API_Layer'
import type { RedisStatus, ScanPage, KeyDetail } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

export const RedisServices = {
  async status(): Promise<RedisStatus> {
    const res = await BAPI.get<ApiResponse<RedisStatus>>(
      '/api/redis/status',
      { showGlobalError: false, showGlobalSuccess: false }
    )
    return res.data
  },

  async scanKeys(pattern: string, cursor: string, count = 50): Promise<ScanPage> {
    const res = await BAPI.get<ApiResponse<ScanPage>>(
      '/api/redis/keys',
      { params: { pattern, cursor, count }, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async getKeyDetail(key: string): Promise<KeyDetail> {
    const res = await BAPI.get<ApiResponse<KeyDetail>>(
      '/api/redis/key',
      { params: { key }, showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async deleteKey(key: string): Promise<void> {
    await BAPI.delete<ApiResponse<null>>(
      '/api/redis/key',
      undefined,
      { params: { key }, showGlobalError: true, showGlobalSuccess: true }
    )
  },

  async flush(): Promise<number> {
    const res = await BAPI.post<ApiResponse<{ deleted: number }>>(
      '/api/redis/flush',
      {},
      { showGlobalError: true, showGlobalSuccess: true }
    )
    return res.data.deleted
  },
}
