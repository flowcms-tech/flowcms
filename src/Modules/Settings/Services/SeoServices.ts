import BAPI from '@/Framework/API_Layer'

interface ApiResponse<T> { data: T; message: string | string[] }

/**
 * Kept separate from SettingsServices because the IndexNow key is not an
 * editable setting — it is minted server-side and written straight to the
 * settings row. There is deliberately no field for it in
 * `updateSiteSettingsSchema`: a hand-typed key that doesn't match the file
 * served at `keyLocation` makes every submission fail with a 403 that surfaces
 * nowhere useful.
 */
export const SeoServices = {
  /** POSTs to the IndexNow route, which generates and stores a key. The
   *  response shape is owned by that route, so callers should refetch
   *  ['global-settings'] rather than trusting anything but the key back. */
  async generateIndexNowKey(): Promise<string | null> {
    const res = await BAPI.post<ApiResponse<{ indexNowKey?: string }>>(
      '/api/integrations/indexnow',
      {},
      { showGlobalError: false, showGlobalSuccess: false }
    )
    return res.data?.indexNowKey ?? null
  },
}
