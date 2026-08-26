import type { ResolvedBusinessProfile } from "@/Framework/Settings/businessProfile"

/**
 * schema.org `LocalBusiness` markup, built entirely from Settings.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * Structured data is a set of factual claims, published in machine-readable
 * form, attributed to whoever installed FlowCMS. So the rule here is that every
 * property comes from something an operator typed, and anything unset is
 * OMITTED rather than defaulted or nulled.
 *
 * The previous version of this file did the opposite, and it is worth recording
 * what that looked like so it does not come back:
 *
 *   - a hardcoded `description` describing a mobile locksmith serving the
 *     Greater Toronto Area, emitted for every installation;
 *   - a `hasOfferCatalog` listing a dozen locksmith services from a config file;
 *   - `areaServed` entries each wrapped in
 *     `containedInPlace: "Ontario, Canada"`, asserting a province for any
 *     operator's service areas;
 *   - `address` and `telephone` keys emitted unconditionally, so an
 *     unconfigured install published `"streetAddress": null`.
 *
 * Two omissions are inherited deliberately from the original and remain
 * correct:
 *
 *   - **No `aggregateRating` or `review`.** The `business_review` table exists,
 *     but marking up testimonials as ratings is structured-data spam and a
 *     manual-action risk unless the ratings are computed from published reviews
 *     that also render on the page. There must never be a settings field for a
 *     hand-typed average — a typed-in 4.9 is an assertion nobody can
 *     substantiate.
 *   - **No credential properties.** `hasCredential` ("licensed", "bonded",
 *     "insured") is a legal claim. The constraint is evidence, not storage, so
 *     adding a settings field would not make it safe to emit.
 *
 * Returns `null` when the business profile is unconfigured. Callers render
 * nothing in that case — a `LocalBusiness` node with no name is not degraded
 * markup, it is invalid markup.
 */

export interface LocalBusinessSchema {
  "@context": string
  "@graph": unknown[]
}

/** Drops keys whose value is null, undefined, or an empty array/string. */
function compact(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue
    if (typeof value === "string" && value.trim() === "") continue
    out[key] = value
  }
  return out
}

/**
 * `https://example.com/services` → `https://example.com/#business`.
 *
 * Origin-scoped rather than page-scoped: the business is one entity across the
 * whole site, so every page emitting it must use the same `@id` or crawlers see
 * a separate organisation per URL. Returns undefined rather than throwing on a
 * malformed URL — a missing `@id` is a weaker graph, an exception is a blank
 * page.
 */
function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return `${new URL(url).origin}/#business`
  } catch {
    return undefined
  }
}

export function buildLocalBusinessSchema(
  profile: ResolvedBusinessProfile,
  url: string | undefined
): LocalBusinessSchema | null {
  if (!profile.isConfigured) return null

  const businessId = originOf(url)

  const address = profile.address
    ? compact({
        "@type": "PostalAddress",
        streetAddress: profile.address.street,
        addressLocality: profile.address.city,
        addressRegion: profile.address.region,
        postalCode: profile.address.postalCode,
        addressCountry: profile.address.country,
      })
    : null

  const business = compact({
    "@type": profile.businessType,
    "@id": businessId,
    name: profile.name,
    legalName: profile.legalName,
    telephone: profile.phone,
    email: profile.email,
    url,
    // An address object holding nothing but its own @type is not an address.
    address: address && Object.keys(address).length > 1 ? address : null,
    geo: profile.geo
      ? {
          "@type": "GeoCoordinates",
          latitude: profile.geo.latitude,
          longitude: profile.geo.longitude,
        }
      : null,
    priceRange: profile.priceRange,
    sameAs: profile.socialProfileUrls,
    // A bare `Place`. Naming a containing administrative area would mean
    // guessing which country or region the operator's towns are in.
    areaServed: profile.serviceAreaNames.map((area) => ({
      "@type": "Place",
      name: area,
    })),
    openingHoursSpecification: profile.openingHours.map((hours) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: hours.dayOfWeek,
      opens: hours.opens,
      closes: hours.closes,
    })),
  })

  // One @graph per page. Independent <script> blocks each carrying their own
  // copy of the organisation are the most common duplicate-node warning in the
  // Rich Results Test.
  return { "@context": "https://schema.org", "@graph": [business] }
}
