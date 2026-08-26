import type { Metadata } from "next"
import { getBaseUrl, getBrand } from "@/Framework/Settings/SettingsService"
import { htmlToPlainText } from "@/Framework/Functions/sanitizePostContent"
import type { PublicCustomPage } from "../Queries/publicPageQueries"

function joinUrl(base: string, path: string): string {
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}

/**
 * No meta-template rendering here (that vocabulary — `%category%`, `%tag%`
 * — is blog-specific). Fallback chain is simple: an admin-set value always
 * wins, otherwise fall back to a plain title/description built from the
 * page itself.
 */
export async function buildPageMetadata(page: PublicCustomPage): Promise<Metadata> {
  const [base, brand] = await Promise.all([getBaseUrl(), getBrand()])

  const title = page.metaTitle || `${page.title} — ${brand.siteName}`
  const description = page.metaDescription || htmlToPlainText(page.content).slice(0, 160)
  const canonical = page.canonicalUrl || joinUrl(base, page.path)

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      siteName: brand.siteName,
      url: canonical,
      title,
      description,
      ...(page.ogImageUrl ? { images: [{ url: page.ogImageUrl, width: 1200, height: 630 }] } : {}),
    },
    robots: page.isIndexable ? undefined : { index: false, follow: true },
  }
}
