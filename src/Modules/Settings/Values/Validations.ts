import { z } from 'zod'
import { parseRobotsRules, parseRobotsSitemaps } from './robotsRules'

/** schema.org day names — the only values `OpeningHoursSpecification.dayOfWeek`
 *  may hold. Kept as plain strings rather than a `z.enum` so the parsed-from-JSON
 *  shape coming back out of the settings row types identically to the form's. */
export const OPENING_HOURS_DAYS = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
] as const

/** The `%variables%` a meta template may contain. Rendered as a cheat sheet in
 *  the SEO settings tab — an unknown variable resolves to an empty string at
 *  render time rather than leaking a literal `%foo%` onto a live page, so the
 *  list is the only place an editor learns what actually exists. */
export const META_TEMPLATE_VARIABLES = [
  '%title%', '%sitename%', '%sep%', '%excerpt%', '%category%', '%primary_category%',
  '%tag%', '%author%', '%date%', '%modified%', '%focus_keyword%', '%page%',
] as const

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export const openingHoursEntrySchema = z.object({
  dayOfWeek: z
    .array(z.string().refine((day) => (OPENING_HOURS_DAYS as readonly string[]).includes(day), 'Unknown day name'))
    .min(1, 'Each opening-hours row needs at least one day'),
  opens: z.string().regex(TIME_PATTERN, 'Opening time must be a 24-hour HH:MM value'),
  closes: z.string().regex(TIME_PATTERN, 'Closing time must be a 24-hour HH:MM value'),
})

export type OpeningHoursEntryValues = z.infer<typeof openingHoursEntrySchema>

/** Latitude/longitude are stored as text, not reals — they're copied out of a
 *  map URL and pasted straight into JSON-LD, and round-tripping through a float
 *  is how "43.7615" becomes "43.761500000000005". Validated numerically anyway,
 *  because an out-of-range coordinate puts the business in the ocean. */
const geoCoordinate = (label: string, min: number, max: number) =>
  z
    .string()
    .max(30)
    .refine((raw) => {
      const value = raw.trim()
      if (value === '') return true
      const parsed = Number(value)
      return Number.isFinite(parsed) && parsed >= min && parsed <= max
    }, `${label} must be a number between ${min} and ${max}, or blank`)
    .optional()

// Every field is optional: the Global and Storage tabs each submit only
// their own subset, and each field can independently be "not overridden"
// (the app falls back to its env var). An empty string on submit means
// "clear this override," not "invalid input" — see the route's own handling.
export const updateSiteSettingsSchema = z.object({
  siteName: z.string().max(100, 'Keep the site name under 100 characters').optional(),
  tagline: z.string().max(200, 'Keep the tagline under 200 characters').optional(),
  logoKey: z.string().optional(),
  logoAltText: z.string().max(125, 'Keep alt text under 125 characters').optional(),
  faviconKey: z.string().optional(),

  baseUrl: z.union([z.string().url('Must be a full URL, e.g. https://flowcms.tech'), z.literal('')]).optional(),

  s3Endpoint: z.union([z.string().url('Must be a full URL'), z.literal('')]).optional(),
  s3Region: z.string().max(100).optional(),
  s3Bucket: z.string().max(200).optional(),
  s3AccessKeyId: z.string().max(200).optional(),
  s3SecretAccessKey: z.string().max(500).optional(),
  /** Explicit intent to clear the stored secret and fall back to the env
   *  var — a blank field alone can't mean this, since the field is always
   *  rendered blank regardless of whether a secret is already stored. */
  clearS3SecretAccessKey: z.boolean().optional(),

  gscClientId: z.string().max(200).optional(),
  gscClientSecret: z.string().max(500).optional(),
  gscSiteUrl: z.string().max(300).optional(),
  /** Clears the OAuth client secret — the route also clears the refresh
   *  token when this is set, since a token minted under the old secret
   *  can't be exchanged for an access token anymore either way. */
  clearGscClientSecret: z.boolean().optional(),
  /** The "Disconnect" button's payload — clears only the refresh token, not
   *  the client ID/secret, so reconnecting is one click on "Connect" rather
   *  than re-entering OAuth credentials. */
  clearGscRefreshToken: z.boolean().optional(),

  // -- PageSpeed Insights (Core Web Vitals) -----------------------------------
  pagespeedApiKey: z.string().max(200).optional(),
  clearPagespeedApiKey: z.boolean().optional(),

  // -- Bing Webmaster Tools ----------------------------------------------------
  bingApiKey: z.string().max(200).optional(),
  clearBingApiKey: z.boolean().optional(),
  bingSiteUrl: z.string().max(300).optional(),

  // -- Meta templates --------------------------------------------------------
  // Generous 300-char cap rather than the ~60 a title should render at: the
  // template is source text full of %variables% that collapse on render, so
  // measuring the template against the output limit would reject templates
  // that produce perfectly short titles.
  metaTitleTemplate: z.string().max(300, 'Keep the title template under 300 characters').optional(),
  metaDescriptionTemplate: z.string().max(300, 'Keep the description template under 300 characters').optional(),
  categoryTitleTemplate: z.string().max(300, 'Keep the category title template under 300 characters').optional(),
  tagTitleTemplate: z.string().max(300, 'Keep the tag title template under 300 characters').optional(),
  authorTitleTemplate: z.string().max(300, 'Keep the author title template under 300 characters').optional(),
  titleSeparator: z.string().max(5, 'A separator longer than 5 characters is a phrase, not a separator').optional(),

  // -- Link handling ---------------------------------------------------------
  externalLinkRel: z.string().max(100, 'Keep the rel value under 100 characters').optional(),
  externalLinkNewTab: z.boolean().optional(),

  // -- Indexing --------------------------------------------------------------
  indexNowEnabled: z.boolean().optional(),
  googleIndexingApiEnabled: z.boolean().optional(),
  newsSitemapEnabled: z.boolean().optional(),
  robotsExtraRules: z
    .string()
    .max(2000, 'Keep extra robots rules under 2000 characters')
    .superRefine((raw, ctx) => {
      for (const message of parseRobotsRules(raw).errors) {
        ctx.addIssue({ code: 'custom', message })
      }
    })
    .optional(),
  robotsExtraSitemaps: z
    .string()
    .max(2000, 'Keep extra sitemap URLs under 2000 characters')
    .superRefine((raw, ctx) => {
      // Same parser the robots.txt route and the live preview use — a second
      // implementation here would eventually accept a line the file drops.
      for (const message of parseRobotsSitemaps(raw).errors) {
        ctx.addIssue({ code: 'custom', message })
      }
    })
    .optional(),

  // -- Business / LocalBusiness ----------------------------------------------
  // Blank means "publish nothing for this field" — there is no fallback source.
  // None is required, because a half-filled Business tab must still produce
  // coherent markup; the resolver simply omits whatever is missing.
  //
  // `businessName` is the switch: with it blank, no LocalBusiness node is
  // emitted at all.
  businessName: z.string().max(200, 'Keep the business name under 200 characters').optional(),
  businessLegalName: z.string().max(200, 'Keep the legal name under 200 characters').optional(),
  businessType: z.string().max(60, 'Keep the schema.org type under 60 characters').optional(),
  businessPhone: z.string().max(40, 'Keep the phone number under 40 characters').optional(),
  businessEmail: z.union([z.string().email('Must be a valid email address'), z.literal('')]).optional(),
  addressStreet: z.string().max(200, 'Keep the street address under 200 characters').optional(),
  addressCity: z.string().max(200, 'Keep the city under 200 characters').optional(),
  addressRegion: z.string().max(200, 'Keep the province/region under 200 characters').optional(),
  addressPostalCode: z.string().max(200, 'Keep the postal code under 200 characters').optional(),
  addressCountry: z.string().max(200, 'Keep the country under 200 characters').optional(),
  geoLatitude: geoCoordinate('Latitude', -90, 90),
  geoLongitude: geoCoordinate('Longitude', -180, 180),
  priceRange: z.string().max(20, 'Keep the price range under 20 characters').optional(),

  // Structured values, not raw JSON: the route stringifies them on write and
  // parses them on read. An admin typing JSON into a textarea is one missing
  // brace away from markup that silently stops emitting.
  openingHours: z.array(openingHoursEntrySchema).max(14, 'That is more opening-hours rows than a week has days').optional(),
  serviceAreaNames: z.array(z.string().max(120, 'Keep each service area under 120 characters')).max(100).optional(),
  socialProfileUrls: z
    .array(z.union([z.string().url('Each social profile must be a full URL, e.g. https://facebook.com/yourpage'), z.literal('')]))
    .max(25)
    .optional(),
})

export type UpdateSiteSettingsFormValues = z.infer<typeof updateSiteSettingsSchema>
