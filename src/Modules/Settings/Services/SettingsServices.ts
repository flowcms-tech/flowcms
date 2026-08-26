import BAPI from '@/Framework/API_Layer'
import type { SiteSettings, UpdateSiteSettingsPayload } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

// Backs both the Global and Storage settings tabs — they're separate pages
// editing separate fields of the same singleton settings row, not separate
// resources, so there is exactly one GET/PATCH pair between them.
export const SettingsServices = {
  async get(): Promise<SiteSettings> {
    const res = await BAPI.get<ApiResponse<SiteSettings>>(
      '/api/settings/global',
      { showGlobalError: true, showGlobalSuccess: false }
    )
    return res.data
  },

  async update(payload: UpdateSiteSettingsPayload): Promise<SiteSettings> {
    const res = await BAPI.patch<ApiResponse<SiteSettings>>(
      '/api/settings/global',
      payload,
      {
        showGlobalError: false,
        showGlobalSuccess: true,
        // Without this, BAPI strips empty strings from the body and the route
        // reads a cleared field as absent — i.e. "leave unchanged". Every text
        // setting would be settable once and never blankable again. The route
        // already maps `'' → null`; this is what lets that path be reached.
        // Blank secrets are still safe: the route treats them as "keep the
        // current value" and has explicit `clearX` flags for deletion.
        keepEmptyStrings: true,
      }
    )
    return res.data
  },
}
