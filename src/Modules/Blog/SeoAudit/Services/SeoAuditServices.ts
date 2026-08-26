import BAPI from '@/Framework/API_Layer'
import type { LinkCheckReport, LinkScanOutcome, SeoAuditReport } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

export const SeoAuditServices = {
  async report(): Promise<SeoAuditReport> {
    const res = await BAPI.get<ApiResponse<SeoAuditReport>>('/api/blog/seo-audit', {
      showGlobalError: true,
      showGlobalSuccess: false,
    })
    return res.data
  },

  async linkResults(postId?: string): Promise<LinkCheckReport> {
    const res = await BAPI.get<ApiResponse<LinkCheckReport>>('/api/blog/link-check', {
      params: postId ? { postId } : undefined,
      showGlobalError: true,
      showGlobalSuccess: false,
    })
    return res.data
  },

  /** Omit `postId` to scan every non-trashed post. This makes real outbound
   *  HTTP requests, so it is only ever called from an explicit button press. */
  async scanLinks(postId?: string): Promise<LinkScanOutcome> {
    const res = await BAPI.post<ApiResponse<LinkScanOutcome>>(
      '/api/blog/link-check',
      postId ? { postId } : {},
      { showGlobalError: true, showGlobalSuccess: true }
    )
    return res.data
  },
}
