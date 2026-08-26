import BAPI from '@/Framework/API_Layer'
import type {
  SiteSettingsListResponse,
  BlockedUrl,
  QueryParameter,
  CountryRegionSetting,
  DeepLinkBlock,
  PagePreviewBlock,
  SiteRole,
  SiteMove,
} from '../Types/siteSettings'

interface ApiResponse<T> { data: T; message: string | string[] }

const BASE = '/api/integrations/bing-webmaster/site-settings'
const READ = { showGlobalError: true, showGlobalSuccess: false }
const WRITE = { showGlobalError: false, showGlobalSuccess: true }

export const SiteSettingsServices = {
  // -- Blocked URLs ----------------------------------------------------------
  async blockedUrls(): Promise<SiteSettingsListResponse<BlockedUrl>> {
    const res = await BAPI.get<ApiResponse<SiteSettingsListResponse<BlockedUrl>>>(`${BASE}/blocked-urls`, READ)
    return res.data
  },
  async addBlockedUrl(input: { url: string; entityType: number; requestType: number }): Promise<SiteSettingsListResponse<BlockedUrl>> {
    const res = await BAPI.post<ApiResponse<SiteSettingsListResponse<BlockedUrl>>>(`${BASE}/blocked-urls`, input, WRITE)
    return res.data
  },
  async removeBlockedUrl(input: { url: string; entityType: number; requestType: number }): Promise<SiteSettingsListResponse<BlockedUrl>> {
    const res = await BAPI.delete<ApiResponse<SiteSettingsListResponse<BlockedUrl>>>(`${BASE}/blocked-urls`, input, WRITE)
    return res.data
  },

  // -- Query parameters --------------------------------------------------------
  async queryParams(): Promise<SiteSettingsListResponse<QueryParameter>> {
    const res = await BAPI.get<ApiResponse<SiteSettingsListResponse<QueryParameter>>>(`${BASE}/query-params`, READ)
    return res.data
  },
  async addQueryParam(queryParameter: string): Promise<SiteSettingsListResponse<QueryParameter>> {
    const res = await BAPI.post<ApiResponse<SiteSettingsListResponse<QueryParameter>>>(`${BASE}/query-params`, { queryParameter }, WRITE)
    return res.data
  },
  async toggleQueryParam(queryParameter: string, isEnabled: boolean): Promise<SiteSettingsListResponse<QueryParameter>> {
    const res = await BAPI.patch<ApiResponse<SiteSettingsListResponse<QueryParameter>>>(`${BASE}/query-params`, { queryParameter, isEnabled }, WRITE)
    return res.data
  },
  async removeQueryParam(queryParameter: string): Promise<SiteSettingsListResponse<QueryParameter>> {
    const res = await BAPI.delete<ApiResponse<SiteSettingsListResponse<QueryParameter>>>(`${BASE}/query-params`, { queryParameter }, WRITE)
    return res.data
  },

  // -- Regional (country/region) ------------------------------------------------
  async regional(): Promise<SiteSettingsListResponse<CountryRegionSetting>> {
    const res = await BAPI.get<ApiResponse<SiteSettingsListResponse<CountryRegionSetting>>>(`${BASE}/regional`, READ)
    return res.data
  },
  async addRegional(input: { twoLetterIsoCountryCode: string; type: number; url: string }): Promise<SiteSettingsListResponse<CountryRegionSetting>> {
    const res = await BAPI.post<ApiResponse<SiteSettingsListResponse<CountryRegionSetting>>>(`${BASE}/regional`, input, WRITE)
    return res.data
  },
  async removeRegional(input: { twoLetterIsoCountryCode: string; type: number; url: string }): Promise<SiteSettingsListResponse<CountryRegionSetting>> {
    const res = await BAPI.delete<ApiResponse<SiteSettingsListResponse<CountryRegionSetting>>>(`${BASE}/regional`, input, WRITE)
    return res.data
  },

  // -- Deep link blocks ----------------------------------------------------------
  async deepLinkBlocks(): Promise<SiteSettingsListResponse<DeepLinkBlock>> {
    const res = await BAPI.get<ApiResponse<SiteSettingsListResponse<DeepLinkBlock>>>(`${BASE}/deep-link-blocks`, READ)
    return res.data
  },
  async addDeepLinkBlock(input: { market: string; searchUrl: string; deepLinkUrl: string }): Promise<SiteSettingsListResponse<DeepLinkBlock>> {
    const res = await BAPI.post<ApiResponse<SiteSettingsListResponse<DeepLinkBlock>>>(`${BASE}/deep-link-blocks`, input, WRITE)
    return res.data
  },
  async removeDeepLinkBlock(input: { market: string; searchUrl: string; deepLinkUrl: string }): Promise<SiteSettingsListResponse<DeepLinkBlock>> {
    const res = await BAPI.delete<ApiResponse<SiteSettingsListResponse<DeepLinkBlock>>>(`${BASE}/deep-link-blocks`, input, WRITE)
    return res.data
  },

  // -- Page preview blocks ----------------------------------------------------------
  async pagePreviewBlocks(): Promise<SiteSettingsListResponse<PagePreviewBlock>> {
    const res = await BAPI.get<ApiResponse<SiteSettingsListResponse<PagePreviewBlock>>>(`${BASE}/page-preview-blocks`, READ)
    return res.data
  },
  async addPagePreviewBlock(url: string, reason: string): Promise<SiteSettingsListResponse<PagePreviewBlock>> {
    const res = await BAPI.post<ApiResponse<SiteSettingsListResponse<PagePreviewBlock>>>(`${BASE}/page-preview-blocks`, { url, reason }, WRITE)
    return res.data
  },
  async removePagePreviewBlock(url: string): Promise<SiteSettingsListResponse<PagePreviewBlock>> {
    const res = await BAPI.delete<ApiResponse<SiteSettingsListResponse<PagePreviewBlock>>>(`${BASE}/page-preview-blocks`, { url }, WRITE)
    return res.data
  },

  // -- Roles -----------------------------------------------------------------------
  async roles(): Promise<SiteSettingsListResponse<SiteRole>> {
    const res = await BAPI.get<ApiResponse<SiteSettingsListResponse<SiteRole>>>(`${BASE}/roles`, READ)
    return res.data
  },
  async addRole(input: {
    delegatedUrl: string
    userEmail: string
    authenticationCode: string
    isAdministrator: boolean
    isReadOnly: boolean
  }): Promise<SiteSettingsListResponse<SiteRole>> {
    const res = await BAPI.post<ApiResponse<SiteSettingsListResponse<SiteRole>>>(`${BASE}/roles`, input, WRITE)
    return res.data
  },
  async removeRole(role: SiteRole): Promise<SiteSettingsListResponse<SiteRole>> {
    const res = await BAPI.delete<ApiResponse<SiteSettingsListResponse<SiteRole>>>(`${BASE}/roles`, { role }, WRITE)
    return res.data
  },

  // -- Site moves --------------------------------------------------------------------
  async siteMoves(): Promise<SiteSettingsListResponse<SiteMove>> {
    const res = await BAPI.get<ApiResponse<SiteSettingsListResponse<SiteMove>>>(`${BASE}/site-moves`, READ)
    return res.data
  },
  async submitSiteMove(input: { moveScope: number; moveType: number; sourceUrl: string; targetUrl: string }): Promise<SiteSettingsListResponse<SiteMove>> {
    const res = await BAPI.post<ApiResponse<SiteSettingsListResponse<SiteMove>>>(`${BASE}/site-moves`, input, WRITE)
    return res.data
  },
}
