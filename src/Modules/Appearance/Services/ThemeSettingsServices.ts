import BAPI from '@/Framework/API_Layer'
import type { ThemeSettingValue } from '@/Themes/contract/settings'
import type { ThemeSettingsAdminView } from '../Queries/themeSettingsAdminQueries'

interface ApiResponse<T> { data: T; message: string | string[] }

/**
 * Theme Settings calls into this app's own API.
 *
 * Writes surface their errors inline next to the form — "that value is not one
 * of the options" is something to read and correct, not something to dismiss.
 */
export const ThemeSettingsServices = {
  async get(theme: string): Promise<ThemeSettingsAdminView> {
    const res = await BAPI.get<ApiResponse<ThemeSettingsAdminView>>(
      `/api/appearance/theme-settings?theme=${encodeURIComponent(theme)}`,
      { showGlobalError: true, showGlobalSuccess: false },
    )
    return res.data
  },

  async save(theme: string, values: Record<string, ThemeSettingValue>) {
    const res = await BAPI.put<ApiResponse<{ theme: string; changed: boolean }>>(
      '/api/appearance/theme-settings',
      { theme, values },
      { showGlobalError: false, showGlobalSuccess: true },
    )
    return res.data
  },

  async reset(theme: string) {
    const res = await BAPI.delete<ApiResponse<{ theme: string; changed: boolean }>>(
      `/api/appearance/theme-settings?theme=${encodeURIComponent(theme)}`,
      { showGlobalError: false, showGlobalSuccess: true },
    )
    return res.data
  },
}
