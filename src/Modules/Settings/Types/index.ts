/** One row of the structured opening-hours editor, and one entry of the
 *  schema.org `OpeningHoursSpecification[]` the JSON-LD emits. Stored as JSON
 *  in a single column; parsed by the GET route so the admin never sees JSON. */
export interface OpeningHoursEntry {
  dayOfWeek: string[]
  opens: string
  closes: string
}

export interface SiteSettings extends Record<string, unknown> {
  siteName: string
  tagline: string
  logoKey: string | null
  logoAltText: string | null
  logoUrl: string | null
  faviconKey: string | null
  faviconUrl: string | null
  baseUrl: string
  /** Which storage backend is running. Environment-only; never editable here. */
  /** Where the files ACTUALLY are — the durable snapshot, not the environment. */
  storageDriver: "s3" | "local" | null
  /** What STORAGE_DRIVER names. A candidate after a migration, never the fact. */
  deploymentStorageDriver: "s3" | "local" | null
  deploymentLocalStoragePath: string
  /** Only set for the local driver. Deployment-controlled, shown read-only. */
  localStoragePath: string
  s3Endpoint: string
  s3Region: string
  s3Bucket: string
  s3AccessKeyId: string
  hasS3SecretAccessKey: boolean
  gscClientId: string
  hasGscClientSecret: boolean
  hasGscRefreshToken: boolean
  gscSiteUrl: string
  /** Computed from baseUrl, not stored — the exact value to register as the
   *  OAuth client's authorized redirect URI in Google Cloud Console. */
  gscRedirectUri: string
  hasPagespeedApiKey: boolean
  bingSiteUrl: string
  hasBingApiKey: boolean

  // -- Meta templates --------------------------------------------------------
  // Returned raw (blank when never set), not resolved: the form has to be able
  // to show "not overridden" as an empty field with the default as its
  // placeholder. Consumers that want a usable value call getMetaTemplates().
  metaTitleTemplate: string
  metaDescriptionTemplate: string
  categoryTitleTemplate: string
  tagTitleTemplate: string
  authorTitleTemplate: string
  titleSeparator: string

  // -- Link handling ---------------------------------------------------------
  externalLinkRel: string
  externalLinkNewTab: boolean

  // -- Indexing --------------------------------------------------------------
  /** Not a secret — IndexNow requires it be publicly retrievable over HTTP,
   *  so it is shown in the admin rather than masked like the S3/GSC secrets. */
  indexNowKey: string
  indexNowEnabled: boolean
  googleIndexingApiEnabled: boolean
  newsSitemapEnabled: boolean
  robotsExtraRules: string
  robotsExtraSitemaps: string

  // -- Business / LocalBusiness ----------------------------------------------
  // Also raw, for the same reason: a blank field here means "fall back to
  // business.ts", and resolving before serialising would make that
  // indistinguishable from a value the owner typed by hand.
  businessLegalName: string
  businessType: string
  businessPhone: string
  businessEmail: string
  addressStreet: string
  addressCity: string
  addressRegion: string
  addressPostalCode: string
  addressCountry: string
  geoLatitude: string
  geoLongitude: string
  priceRange: string
  /** Parsed out of their JSON columns by the GET route — never strings here. */
  openingHours: OpeningHoursEntry[]
  serviceAreaNames: string[]
  socialProfileUrls: string[]
}

export interface UpdateSiteSettingsPayload {
  siteName?: string
  tagline?: string
  logoKey?: string
  logoAltText?: string
  faviconKey?: string
  baseUrl?: string
  s3Endpoint?: string
  s3Region?: string
  s3Bucket?: string
  s3AccessKeyId?: string
  s3SecretAccessKey?: string
  clearS3SecretAccessKey?: boolean
  gscClientId?: string
  gscClientSecret?: string
  gscSiteUrl?: string
  clearGscClientSecret?: boolean
  clearGscRefreshToken?: boolean
  pagespeedApiKey?: string
  clearPagespeedApiKey?: boolean
  bingApiKey?: string
  clearBingApiKey?: boolean
  bingSiteUrl?: string

  metaTitleTemplate?: string
  metaDescriptionTemplate?: string
  categoryTitleTemplate?: string
  tagTitleTemplate?: string
  authorTitleTemplate?: string
  titleSeparator?: string

  externalLinkRel?: string
  externalLinkNewTab?: boolean

  indexNowEnabled?: boolean
  googleIndexingApiEnabled?: boolean
  newsSitemapEnabled?: boolean
  robotsExtraRules?: string
  robotsExtraSitemaps?: string

  businessLegalName?: string
  businessType?: string
  businessPhone?: string
  businessEmail?: string
  addressStreet?: string
  addressCity?: string
  addressRegion?: string
  addressPostalCode?: string
  addressCountry?: string
  geoLatitude?: string
  geoLongitude?: string
  priceRange?: string
  openingHours?: OpeningHoursEntry[]
  serviceAreaNames?: string[]
  socialProfileUrls?: string[]
}
