import "server-only"
import {
  getBaseUrl,
  getBrand,
  getBusinessProfile,
} from "@/Framework/Settings/SettingsService"
import { DEFAULT_SITE_NAME, type ResolvedBrand } from "@/Framework/Settings/businessProfile"
import { publicImagePath } from "@/Framework/Storage/publicImageUrl"
import { buildLocalBusinessSchema } from "../Values/buildLocalBusinessJsonLd"
import type { BrandView, HomeView, NotFoundView } from "@/Themes/contract/views"

/**
 * View models for the site-wide surfaces: Home, NotFound, and the brand block
 * every Layout receives.
 */

/** Storage keys never cross into a theme — resolve to a URL here. */
export function toBrandView(brand: ResolvedBrand): BrandView {
  return {
    siteName: brand.siteName,
    tagline: brand.tagline,
    logoUrl: brand.logoKey ? publicImagePath(brand.logoKey) : null,
    logoAltText: brand.logoAltText,
  }
}

/**
 * Brand for surfaces that must render even when Settings is unreachable.
 *
 * The 404 page is the one public surface whose whole job is to work when
 * something else has already gone wrong, and Next prerenders it during
 * `next build`, where there is no database at all. Failing there would turn a
 * missing page into a build failure and, at runtime, a 500. Falling back to the
 * product name is the honest degrade: the visitor still gets their 404.
 */
export async function getBrandViewOrDefault(): Promise<BrandView> {
  try {
    return toBrandView(await getBrand())
  } catch {
    return { siteName: DEFAULT_SITE_NAME, tagline: null, logoUrl: null, logoAltText: null }
  }
}

/** The brand block every Layout receives. Resolved by core so the theme never
 *  reads Settings and never sees a storage key. */
export async function getBrandView(): Promise<BrandView> {
  return toBrandView(await getBrand())
}

export async function buildHomeView(): Promise<HomeView> {
  const [brand, businessProfile, baseUrl] = await Promise.all([
    getBrand(),
    getBusinessProfile(),
    getBaseUrl(),
  ])

  return {
    brand: toBrandView(brand),
    // Null for an unconfigured install. `buildLocalBusinessSchema` omits the
    // whole node rather than emitting one built out of nulls — see its tests.
    jsonLd: buildLocalBusinessSchema(businessProfile, baseUrl),
  }
}

export async function buildNotFoundView(): Promise<NotFoundView> {
  return { brand: await getBrandViewOrDefault() }
}
