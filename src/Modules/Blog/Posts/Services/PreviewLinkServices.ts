import BAPI from '@/Framework/API_Layer'
import type { PreviewExpiry } from '@/Framework/Auth/previewToken'

interface ApiResponse<T> { data: T; message: string | string[] }

export interface PreviewLink {
  url: string
  expiresAt: string
  /** Always false. Carried from the API so the UI cannot drift into implying a
   *  per-link revocation that does not exist — there is no token table. */
  revocable: boolean
}

export const PreviewLinkServices = {
  /**
   * `showGlobalSuccess: false` — the link itself is the feedback, and a toast
   * on top of it would cover the thing the user came to copy. The most likely
   * failure ("PREVIEW_SECRET isn't set") is a sentence the caller renders
   * inline, so the global error toast stays off too.
   */
  async create(postId: string, expiresIn: PreviewExpiry): Promise<PreviewLink> {
    const res = await BAPI.post<ApiResponse<PreviewLink>>(
      `/api/blog/posts/${postId}/preview-link`,
      { expiresIn },
      { showGlobalError: false, showGlobalSuccess: false }
    )
    return res.data
  },
}
