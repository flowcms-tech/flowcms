/**
 * Pure resolution of brand and business-profile settings.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM SettingsService
 *
 * Two reasons, and the second is the important one.
 *
 * 1. `SettingsService` reads the database and the cache, so nothing in it can
 *    be unit-tested without standing both up. The resolution rules — which
 *    field wins, what happens when one is blank — are exactly the part worth
 *    testing, and they are pure. Splitting them out makes them assertable.
 *
 * 2. These rules used to import a *customer's* config file
 *    (`@/Modules/Public/config/business.ts`) as their fallback layer, which
 *    made `src/Framework` depend on `src/Modules` — a layering inversion that
 *    also happened to hardcode one business's street address and phone numbers
 *    into the framework every install would run. Isolating the rules here made
 *    that dependency visible and removable, and `tests/architecture/` now
 *    fails the build if anything under `src/Framework` imports `src/Modules`
 *    again.
 *
 * THE RULE THESE FUNCTIONS FOLLOW
 *
 * An absent setting produces `null` or `[]` — never a plausible substitute.
 * This matters more than it looks. The output feeds `schema.org` LocalBusiness
 * markup, so a guessed address, a guessed price range, or guessed opening
 * hours are not cosmetic defaults; they are false claims published in
 * machine-readable form to search engines, attached to whoever installed the
 * software. Emitting nothing is always the safer failure.
 */

/** schema.org's generic base type. Correct for any local business, and
 *  specific to none — an operator narrows it (Bakery, Dentist, …) themselves. */
export const DEFAULT_BUSINESS_TYPE = "LocalBusiness"

/** Product name, used only until an operator sets their own. */
export const DEFAULT_SITE_NAME = "FlowCMS"

export interface ResolvedBrand {
  siteName: string
  /** Null when unset. There is no default tagline: the previous one was a
   *  customer's marketing line, which then shipped on every install. */
  tagline: string | null
  logoKey: string | null
  logoAltText: string | null
  faviconKey: string | null
}

export interface ResolvedPostalAddress {
  street: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
}

export interface ResolvedOpeningHours {
  dayOfWeek: string[]
  opens: string
  closes: string
}

export interface ResolvedBusinessProfile {
  /**
   * Trading name, and the switch that decides whether any LocalBusiness markup
   * is emitted at all.
   *
   * Deliberately NOT defaulted to `siteName`. They are different things — the
   * site is not the legal entity — and `siteName` itself defaults to "FlowCMS",
   * so the fallback would announce the CMS as the local business on every
   * unconfigured install.
   */
  name: string | null
  legalName: string | null
  /** schema.org type for the business node. */
  businessType: string
  /** E.164 where the operator provides it; feeds `telephone`. */
  phone: string | null
  email: string | null
  /** Null unless at least one address field is filled in. */
  address: ResolvedPostalAddress | null
  /** Both halves or neither — a geo node with only a latitude is invalid and
   *  fails validation rather than degrading. */
  geo: { latitude: string; longitude: string } | null
  priceRange: string | null
  openingHours: ResolvedOpeningHours[]
  serviceAreaNames: string[]
  socialProfileUrls: string[]
  /**
   * Whether there is enough here to emit a LocalBusiness node.
   *
   * Callers check this instead of assembling a node out of nulls. A
   * `LocalBusiness` with no name is not degraded structured data, it is
   * invalid structured data.
   */
  isConfigured: boolean
}

/**
 * The columns these resolvers read.
 *
 * Declared structurally rather than as `typeof settings.$inferSelect` so this
 * module stays free of a Drizzle import — and so a test can pass three fields
 * instead of building a 50-column row.
 */
export interface BrandSource {
  siteName?: string | null
  tagline?: string | null
  logoKey?: string | null
  logoAltText?: string | null
  faviconKey?: string | null
}

export interface BusinessProfileSource {
  businessName?: string | null
  businessLegalName?: string | null
  businessType?: string | null
  businessPhone?: string | null
  businessEmail?: string | null
  addressStreet?: string | null
  addressCity?: string | null
  addressRegion?: string | null
  addressPostalCode?: string | null
  addressCountry?: string | null
  geoLatitude?: string | null
  geoLongitude?: string | null
  priceRange?: string | null
  openingHours?: string | null
  serviceAreaNames?: string | null
  socialProfileUrls?: string | null
}

/** Treats "" and whitespace as unset — a cleared admin field arrives as an
 *  empty string, and "set to blank" means the same thing as "never set". */
function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * Malformed stored JSON degrades to `[]` rather than throwing.
 *
 * This runs on public pages during metadata and JSON-LD generation, where an
 * exception is a 500 on the article itself. A missing `sameAs` is not worth
 * that.
 */
function jsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

export function resolveBrandFrom(row: BrandSource | null | undefined): ResolvedBrand {
  return {
    siteName: text(row?.siteName) ?? DEFAULT_SITE_NAME,
    tagline: text(row?.tagline),
    logoKey: text(row?.logoKey),
    logoAltText: text(row?.logoAltText),
    faviconKey: text(row?.faviconKey),
  }
}

export function resolveBusinessProfileFrom(
  row: BusinessProfileSource | null | undefined
): ResolvedBusinessProfile {
  const name = text(row?.businessName)

  const address: ResolvedPostalAddress = {
    street: text(row?.addressStreet),
    city: text(row?.addressCity),
    region: text(row?.addressRegion),
    postalCode: text(row?.addressPostalCode),
    country: text(row?.addressCountry),
  }
  const hasAnyAddress = Object.values(address).some((part) => part !== null)

  const latitude = text(row?.geoLatitude)
  const longitude = text(row?.geoLongitude)

  return {
    name,
    legalName: text(row?.businessLegalName),
    businessType: text(row?.businessType) ?? DEFAULT_BUSINESS_TYPE,
    phone: text(row?.businessPhone),
    email: text(row?.businessEmail),
    address: hasAnyAddress ? address : null,
    geo: latitude && longitude ? { latitude, longitude } : null,
    priceRange: text(row?.priceRange),
    openingHours: jsonArray<ResolvedOpeningHours>(row?.openingHours),
    serviceAreaNames: jsonArray<string>(row?.serviceAreaNames),
    socialProfileUrls: jsonArray<string>(row?.socialProfileUrls),
    // The name is the minimum. Everything else is optional enrichment of a
    // node that cannot exist without one.
    isConfigured: name !== null,
  }
}
