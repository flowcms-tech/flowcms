import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

/**
 * Site-wide business config, editable from the admin panel — deliberately
 * everything that ISN'T a fundamental/base concern of the application
 * itself. DATABASE_PATH, AUTH_SECRET, CAPTCHA_SECRET, and REDIS_URL stay
 * pure env vars: they're about how this process boots and what it trusts,
 * not something a site owner tunes after launch. Storage credentials, the
 * public site URL, and brand identity are the opposite — an owner should be
 * able to change their bucket or rebrand without anyone touching a server.
 *
 * A single row, not a key-value table: this codebase has zero KV patterns
 * anywhere else, and a typed column per setting keeps every consumer
 * type-checked instead of casting strings pulled out of a generic bag.
 * Adding a new setting later is one migration, matching how every other
 * schema change in this app already works.
 */
export const SETTINGS_SINGLETON_ID = "global"

export const settings = sqliteTable("settings", {
  id: text("id").primaryKey().default(SETTINGS_SINGLETON_ID),

  // -- Brand -------------------------------------------------------------
  siteName: text("siteName"),
  tagline: text("tagline"),
  logoKey: text("logoKey"),
  logoAltText: text("logoAltText"),
  faviconKey: text("faviconKey"),

  // -- Site URL ------------------------------------------------------------
  /** Mirrors NEXT_PUBLIC_BASE_URL. Every consumer already reads this via a
   *  server-side resolver (never inlined into a client bundle), so
   *  overriding it here takes effect immediately — no rebuild required. */
  baseUrl: text("baseUrl"),

  // -- ACTIVE STORAGE TOPOLOGY ----------------------------------------------
  /**
   * WHERE THIS INSTALLATION'S FILES ACTUALLY LIVE — the authoritative answer,
   * and deliberately not the same thing as the deployment's environment.
   *
   * Before Phase 4 the active backend was read straight from `STORAGE_DRIVER`
   * and friends on every request. That is fine for choosing a backend at
   * install time and dangerous afterwards: editing one environment variable and
   * restarting silently repointed a live site at a different, empty location.
   * Every stored key stayed valid, nothing was copied, nothing warned, and
   * every image was gone.
   *
   * So the environment BOOTSTRAPS an installation and this snapshot OWNS it
   * from then on. Once `setupCompletedAt` is set, the first successful
   * configuration resolution pins what is in use here; after that the
   * environment is a candidate, not a command, and moving is a migration.
   *
   * CREDENTIALS ARE NOT HERE, ON PURPOSE. They live in `s3AccessKeyId` /
   * `s3SecretAccessKey` (or the environment) exactly as before, so rotating a
   * key is still an ordinary edit that moves no files. That separation is what
   * makes `storageLocationId()` able to tell a rotation from a relocation.
   */
  activeStorageDriver: text("activeStorageDriver"),
  /** `storageLocationId()` of the active topology. Credential-free by
   *  construction, so it is safe to store, log and compare. */
  activeStorageLocationId: text("activeStorageLocationId"),
  activeStorageEndpoint: text("activeStorageEndpoint"),
  activeStorageRegion: text("activeStorageRegion"),
  activeStorageBucket: text("activeStorageBucket"),
  /** Local driver only. */
  activeStorageRoot: text("activeStorageRoot"),
  /** When this topology became authoritative — first pin, or a cutover. */
  activeStorageEstablishedAt: integer("activeStorageEstablishedAt", { mode: "timestamp_ms" }),

  // -- Storage credentials (S3-compatible) ----------------------------------
  s3Endpoint: text("s3Endpoint"),
  s3Region: text("s3Region"),
  s3Bucket: text("s3Bucket"),
  s3AccessKeyId: text("s3AccessKeyId"),
  /** Never returned by GET /api/settings/global — see that route. The edit
   *  form follows the same "leave blank to keep current" pattern already
   *  used for admin user passwords. */
  s3SecretAccessKey: text("s3SecretAccessKey"),

  // -- Integrations (Google Search Console) --------------------------------
  /** OAuth 2.0 Web application client, created by the site owner in Google
   *  Cloud Console. The client ID is not a secret and is shown in the form. */
  gscClientId: text("gscClientId"),
  /** Same "never returned by GET" treatment as s3SecretAccessKey. */
  gscClientSecret: text("gscClientSecret"),
  /** Issued once, at the end of the OAuth consent flow (access_type=offline,
   *  prompt=consent). Long-lived — used to mint access tokens on demand, so
   *  no access token or expiry is stored. Never returned by GET. */
  gscRefreshToken: text("gscRefreshToken"),
  /** The verified Search Console property this site reports against, e.g.
   *  "https://flowcms.tech/" or "sc-domain:flowcms.tech". Chosen from the list
   *  the connected Google account has access to. */
  gscSiteUrl: text("gscSiteUrl"),

  // -- Integrations (PageSpeed Insights / Core Web Vitals) -------------------
  /** Plain API key, not OAuth — PageSpeed Insights v5 authenticates with a
   *  key alone. Never returned by GET, same "never send it back" treatment
   *  as the other integration secrets. */
  pagespeedApiKey: text("pagespeedApiKey"),

  // -- Integrations (Bing Webmaster Tools) ------------------------------------
  /** Plain API key, not OAuth — one key per Bing Webmaster account, valid for
   *  every site verified on it. Never returned by GET, same "leave blank to
   *  keep current" treatment as pagespeedApiKey. */
  bingApiKey: text("bingApiKey"),
  /** The verified Bing Webmaster site this app reports against, e.g.
   *  "https://flowcms.tech/". Resolved against GetUserSites for the configured
   *  key, same relationship gscSiteUrl has to the GSC OAuth token. */
  bingSiteUrl: text("bingSiteUrl"),

  // -- Meta templates --------------------------------------------------------
  /** e.g. "%title% %sep% %sitename%". Applied when a post leaves metaTitle
   *  blank, so renaming the site doesn't mean editing every post. Per-post
   *  values always win; the template only fills blanks. */
  metaTitleTemplate: text("metaTitleTemplate"),
  metaDescriptionTemplate: text("metaDescriptionTemplate"),
  categoryTitleTemplate: text("categoryTitleTemplate"),
  tagTitleTemplate: text("tagTitleTemplate"),
  authorTitleTemplate: text("authorTitleTemplate"),
  /** The "%sep%" variable. Defaults to "|". */
  titleSeparator: text("titleSeparator"),

  // -- Link handling ---------------------------------------------------------
  /** rel applied to external links when post content is sanitized on write.
   *  Defaults to "nofollow noopener". A hand-set rel="sponsored" or
   *  rel="ugc" is preserved — an editor marking a paid link must not have it
   *  silently rewritten. */
  externalLinkRel: text("externalLinkRel"),
  externalLinkNewTab: integer("externalLinkNewTab", { mode: "boolean" })
    .notNull()
    .default(true),

  // -- Indexing --------------------------------------------------------------
  /** Served at /api/public/indexnow-key.txt and passed as `keyLocation` in
   *  the payload, which the IndexNow spec supports for exactly this case —
   *  it avoids fighting Next's router for a literal /{key}.txt at the root. */
  indexNowKey: text("indexNowKey"),
  indexNowEnabled: integer("indexNowEnabled", { mode: "boolean" })
    .notNull()
    .default(false),
  /**
   * OFF by default, and the UI says why rather than only this comment:
   * Google's Indexing API is officially supported only for JobPosting and
   * BroadcastEvent. Using it for blog posts is outside its documented scope
   * and unreliable. IndexNow plus a correct sitemap is the recommended path.
   */
  googleIndexingApiEnabled: integer("googleIndexingApiEnabled", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Requires an approved Google News publisher account and only ever
   *  contains the last 48 hours of posts. Almost certainly not worth
   *  enabling for this site. */
  newsSitemapEnabled: integer("newsSitemapEnabled", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Extra Disallow/Allow lines, one per line. The generated core rules
   *  always emit regardless — a free-text override of the whole file is one
   *  typo away from de-indexing the site, with a slow and silent failure. */
  robotsExtraRules: text("robotsExtraRules"),
  robotsExtraSitemaps: text("robotsExtraSitemaps"),

  // -- Business / LocalBusiness ----------------------------------------------
  // The ONLY source for LocalBusiness markup. There is no code-level fallback:
  // an unset field emits nothing rather than a substitute. These values are
  // published to search engines as factual claims about whoever installed
  // FlowCMS, so a plausible-looking default is a false statement, not a
  // convenience. See src/Framework/Settings/businessProfile.ts.
  //
  // `businessName` is the switch: with it unset, no LocalBusiness node is
  // emitted at all. It is deliberately separate from `siteName` above — the
  // site is not the legal entity, and `siteName` defaults to "FlowCMS", so
  // borrowing it would announce the CMS itself as the local business.
  businessName: text("businessName"),
  businessLegalName: text("businessLegalName"),
  /** schema.org type. Defaults to the generic "LocalBusiness"; an operator
   *  narrows it themselves (Bakery, Dentist, …). */
  businessType: text("businessType"),
  businessPhone: text("businessPhone"),
  businessEmail: text("businessEmail"),
  addressStreet: text("addressStreet"),
  addressCity: text("addressCity"),
  addressRegion: text("addressRegion"),
  addressPostalCode: text("addressPostalCode"),
  addressCountry: text("addressCountry"),
  geoLatitude: text("geoLatitude"),
  geoLongitude: text("geoLongitude"),
  /** Left blank emits nothing. A guessed price range is a guess published in
   *  machine-readable form. */
  priceRange: text("priceRange"),
  /** JSON — schema.org OpeningHoursSpecification[]. */
  openingHours: text("openingHours"),
  /** JSON string[] — feeds areaServed. */
  serviceAreaNames: text("serviceAreaNames"),
  /** JSON string[] — feeds sameAs. Only profiles the business actually owns. */
  socialProfileUrls: text("socialProfileUrls"),

  // -- Appearance ------------------------------------------------------------
  /**
   * The slug of the theme an operator has activated, or null.
   *
   * NULLABLE, and null means "the default theme" rather than being backfilled
   * to the string "default". A fresh install has no settings row at all — the
   * public site has to render before anyone has configured anything — so the
   * resolver must already treat "no value" as "default". Writing the literal
   * would give the same behaviour two representations and let them disagree.
   *
   * This column holds a slug and nothing else. There is deliberately no
   * `installed_themes` table: which themes exist is a property of the build,
   * and the static registry is its only source of truth. If this column names a
   * theme the running build does not contain, that is a fallback at render
   * time — NOT a reason to rewrite the column. The operator's intent survives
   * the deploy that broke it, which is the only way the admin panel can later
   * explain what happened.
   */
  activeTheme: text("activeTheme"),

  // -- Installation ----------------------------------------------------------
  /**
   * When first-run setup completed, or null if it never has.
   *
   * THE DURABLE INSTALLATION MARKER. This is the single authority for whether
   * an installation has been initialized, and it is deliberately NOT derived
   * from the user count.
   *
   * "Are there any users?" is the obvious test and the wrong one: deleting
   * every account — an operator cleaning up, a botched restore, a bug — would
   * reopen public first-run setup on a live production site and let the next
   * visitor with the deployment token claim ownership of it. A durable marker
   * cannot be un-set by anything the product does.
   *
   * NULLABLE, and null means "never initialized" rather than being backfilled
   * to a sentinel — the same choice `activeTheme` above makes, for the same
   * reason: null is already this schema's representation of "never happened",
   * and a second representation is a second thing to keep in step.
   *
   * A timestamp rather than a boolean because nothing costs extra: every reader
   * tests it against null, and the value answers "when" for an operator reading
   * the row.
   *
   * Existing installations are backfilled by migration 0004, which writes this
   * for any database that already had a user when it upgraded. After that, the
   * user count is never consulted for status again — only as a precondition of
   * the completion mutation, where "create the FIRST owner" is meaningless if
   * one exists. See docs/setup/first-run.md.
   */
  setupCompletedAt: integer("setupCompletedAt", { mode: "timestamp_ms" }),

  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})
