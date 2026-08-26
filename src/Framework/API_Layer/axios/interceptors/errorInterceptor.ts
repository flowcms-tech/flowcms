import type { AxiosInstance, AxiosError } from 'axios'
import ElementToast from '@/components/shared/ElementToast/ElementToast'

/**
 * Wires up response-level success + error handling.
 *
 * Each remaining TODO marks an integration point — replace with the matching utility:
 *   - Redirect → your router (e.g. Next.js router, window.location)
 *   - Loader   → your global loader / spinner store
 */
function extractMessage(message: unknown, fallback: string): string {
  if (Array.isArray(message)) return message.join(', ')
  if (typeof message === 'string' && message) return message
  return fallback
}

export function applyErrorInterceptor(instance: AxiosInstance): void {
  instance.interceptors.response.use(
    // -- Success path ----------------------------------------------------------
    (response) => {
      // TODO: hide global loader → replace with your loader utility
      // e.g. if (response.config.showGlobalLoader) hideLoader()

      if (response.config.showGlobalSuccess && typeof window !== 'undefined') {
        const message = extractMessage(
          (response.data as { message?: unknown })?.message,
          'Done'
        )
        ElementToast.success(message)
      }

      return response
    },

    // -- Error path ------------------------------------------------------------
    (error: AxiosError) => {
      const config = error.config
      const status = error.response?.status
      const showGlobalError = config?.showGlobalError ?? true

      // TODO: hide global loader → replace with your loader utility
      // e.g. if (config?.showGlobalLoader) hideLoader()

      switch (status) {
        case 401:
          // TODO: redirect to login → replace with your router redirect utility
          // e.g. window.location.href = '/login'
          break

        case 403:
          // TODO: redirect to /403 → replace with your router redirect utility
          // e.g. window.location.href = '/403'
          break

        case 404:
        case 410:
          if (typeof window !== 'undefined') {
            // window.location.replace('/not-found')
          } else {
            // notFound()
          }
          break

        case 500:
        case 502:
        case 413:
          // TODO: redirect to /500 → replace with your router redirect utility
          // e.g. window.location.href = '/500'
          break

        case 429:
          // TODO: redirect to /429 → replace with your router redirect utility
          // e.g. window.location.href = '/429'
          break

        default:
          if (showGlobalError && typeof window !== 'undefined') {
            const message = extractMessage(
              (error.response?.data as { message?: unknown })?.message,
              'Something went wrong'
            )
            ElementToast.error(message)
          }
          break
      }

      if (config?.errorCallback) {
        config.errorCallback(error as unknown as Error)
      }

      // Always re-throw — TanStack Query (and direct callers) must receive the error.
      return Promise.reject(error)
    }
  )
}
