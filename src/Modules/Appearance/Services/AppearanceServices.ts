import BAPI from '@/Framework/API_Layer'
import type { ThemeAdminView } from '../Values/themeAdminView'

interface ApiResponse<T> { data: T; message: string | string[] }

export interface ActivateThemeResult {
  activeTheme: string
  /** False when the theme was already selected — an idempotent no-op. */
  changed: boolean
}

export const AppearanceServices = {
  /** Re-read after activation. The page server-renders the first copy, so this
   *  is a refresh rather than the initial load. */
  async listThemes(): Promise<ThemeAdminView> {
    const res = await BAPI.get<ApiResponse<ThemeAdminView>>('/api/appearance/themes', {
      showGlobalError: true,
      showGlobalSuccess: false,
    })
    return res.data
  },

  /** Errors surface inline next to the theme that was refused, not as a toast —
   *  "incompatible with this version of FlowCMS" is something to read, not
   *  something to dismiss. */
  async activate(slug: string): Promise<ActivateThemeResult> {
    const res = await BAPI.post<ApiResponse<ActivateThemeResult>>(
      '/api/appearance/themes',
      { slug },
      { showGlobalError: false, showGlobalSuccess: true },
    )
    return res.data
  },
}
