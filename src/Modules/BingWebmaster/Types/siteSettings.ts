export type SiteSettingsStatus = "ok" | "not_connected"

export interface SiteSettingsListResponse<T> {
  status: SiteSettingsStatus
  reason: string | null
  items: T[]
}

export interface BlockedUrl {
  date: string | null
  entityType: number
  requestType: number
  url: string
}

export interface QueryParameter {
  date: string | null
  isEnabled: boolean
  parameter: string
  source: number
}

export interface CountryRegionSetting {
  date: string | null
  twoLetterIsoCountryCode: string
  type: number
  url: string
}

export interface DeepLinkBlock {
  date: string | null
  market: string
  searchUrl: string
  deepLinkUrl: string
}

export interface PagePreviewBlock {
  date: string | null
  url: string
  reason: string | null
}

export interface SiteRole {
  date: string | null
  delegatedCode: string
  delegatedCodeOwnerEmail: string
  delegatorEmail: string
  email: string
  expired: boolean
  role: number
  site: string
  verificationSite: string
}

export interface SiteMove {
  date: string | null
  moveScope: number
  moveType: number
  sourceUrl: string
  targetUrl: string
}

export const BLOCKED_URL_ENTITY_TYPE = { page: 0, directory: 1 } as const
export const BLOCKED_URL_REQUEST_TYPE = { cacheOnly: 0, fullRemoval: 1 } as const
export const SITE_ROLE = { readWrite: 2 } as const
