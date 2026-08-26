import BAPI from '@/Framework/API_Layer'
import type { BingUrlSubmissionSummary, BingSubmitContentInput } from '../Types/urlSubmission'

interface ApiResponse<T> { data: T; message: string | string[] }

const ROUTE = '/api/integrations/bing-webmaster/url-submission'

export const UrlSubmissionServices = {
  async urlSubmission(): Promise<BingUrlSubmissionSummary> {
    const res = await BAPI.get<ApiResponse<BingUrlSubmissionSummary>>(ROUTE, {
      showGlobalError: true,
      showGlobalSuccess: false,
    })
    return res.data
  },

  async submitUrl(url: string): Promise<void> {
    await BAPI.post<ApiResponse<{ ok: boolean }>>(
      ROUTE,
      { type: 'single', url },
      { showGlobalError: false, showGlobalSuccess: true }
    )
  },

  async submitUrlBatch(urls: string[]): Promise<void> {
    await BAPI.post<ApiResponse<{ ok: boolean }>>(
      ROUTE,
      { type: 'batch', urls },
      { showGlobalError: false, showGlobalSuccess: true }
    )
  },

  async submitContent(input: BingSubmitContentInput): Promise<void> {
    await BAPI.post<ApiResponse<{ ok: boolean }>>(
      ROUTE,
      { type: 'content', input },
      { showGlobalError: false, showGlobalSuccess: true }
    )
  },

  async fetchUrl(url: string): Promise<void> {
    await BAPI.post<ApiResponse<{ ok: boolean }>>(
      ROUTE,
      { type: 'fetch', url },
      { showGlobalError: false, showGlobalSuccess: true }
    )
  },
}
