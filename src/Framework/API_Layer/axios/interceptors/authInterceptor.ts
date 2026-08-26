import type { AxiosInstance } from 'axios'
import { getTokenCookie } from '@/Framework/utils/cookieUtils'

export function applyAuthInterceptor(instance: AxiosInstance): void {
  instance.interceptors.request.use(
    (config) => {
      const token = getTokenCookie()
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
      }
      return config
    },
    (error) => Promise.reject(error)
  )
}
