import BAPI from '@/Framework/API_Layer'
import type { SiteSettings } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

export interface GscSite {
  siteUrl: string
  permissionLevel: string
}

export interface GscConnectionCheck {
  sites: GscSite[]
  configuredSiteUrl: string | null
  configuredSiteVerified: boolean
}

export interface BingSite {
  url: string
  isVerified: boolean
  authenticationCode: string | null
}

export interface BingConnectionCheck {
  sites: BingSite[]
  configuredSiteUrl: string | null
  configuredSiteVerified: boolean
}

export const IntegrationsServices = {
  async checkGscConnection(): Promise<GscConnectionCheck> {
    const res = await BAPI.post<ApiResponse<GscConnectionCheck>>(
      '/api/integrations/google-search-console/check',
      {},
      { showGlobalError: false, showGlobalSuccess: false }
    )
    return res.data
  },

  async disconnectGsc(): Promise<SiteSettings> {
    const res = await BAPI.patch<ApiResponse<SiteSettings>>(
      '/api/settings/global',
      { clearGscRefreshToken: true },
      { showGlobalError: true, showGlobalSuccess: true }
    )
    return res.data
  },

  async checkBingConnection(): Promise<BingConnectionCheck> {
    const res = await BAPI.post<ApiResponse<BingConnectionCheck>>(
      '/api/integrations/bing-webmaster/check',
      {},
      { showGlobalError: false, showGlobalSuccess: false }
    )
    return res.data
  },
}
