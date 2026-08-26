import type { MetadataRoute } from "next"
import { absoluteUrl } from "@/Modules/Blog/Public/Values/buildPostMetadata"
import { getSettingsRow } from "@/Framework/Settings/SettingsService"
import { getAdminPath } from "@/Framework/Config/adminPath"
import {
  CORE_ROBOTS_ALLOW,
  coreRobotsDisallow,
  parseRobotsRules,
  parseRobotsSitemaps,
} from "@/Modules/Settings/Values/robotsRules"

/**
 * The core rules always emit; the settings fields can only add to them. That
 * asymmetry is the whole design — see robotsRules.ts for why a whole-file
 * override is not offered.
 *
 * Invalid extra lines are dropped rather than passed through. They are already
 * rejected at save time with a per-line error, so anything invalid reaching
 * here is stale data from before a validation change, and emitting a malformed
 * directive is worse than emitting none.
 */
// Without this the file prerenders at build time and the settings-driven
// extra rules freeze at whatever they were when the image was built — an
// owner editing robots.txt in the panel would see no change until the next
// deploy, which is the worst possible failure mode for this particular file.
export const dynamic = "force-dynamic"

export default async function robots(): Promise<MetadataRoute.Robots> {
  const [sitemapUrl, row] = await Promise.all([
    absoluteUrl("/sitemap-index.xml"),
    getSettingsRow(),
  ])

  const { rules: extraRules } = parseRobotsRules(row?.robotsExtraRules ?? "")
  const { sitemaps: extraSitemaps } = parseRobotsSitemaps(row?.robotsExtraSitemaps ?? "")

  const allow = [...CORE_ROBOTS_ALLOW]
  const disallow = [...coreRobotsDisallow(getAdminPath())]
  let crawlDelay: number | undefined

  for (const rule of extraRules) {
    if (rule.directive === "Allow") allow.push(rule.value)
    else if (rule.directive === "Disallow") disallow.push(rule.value)
    else if (rule.directive === "Crawl-delay") crawlDelay = Number(rule.value)
  }

  return {
    rules: {
      userAgent: "*",
      // The image route MUST stay crawlable: it serves every OG and JSON-LD
      // image, and a blocked image URL makes structured data fail validation
      // and keeps the post out of Google Images. Crawlers resolve by longest
      // match, so this specific Allow beats the broader /api/ Disallow below.
      allow,
      // The proxy already blocks the admin namespace for anonymous visitors;
      // this is what keeps
      // it out of the index. The rest of /api is machine-only.
      disallow,
      ...(crawlDelay !== undefined && Number.isFinite(crawlDelay) ? { crawlDelay } : {}),
    },
    // The index, not a urlset: src/app/sitemap.ts chunks itself into
    // /sitemap/<id>.xml and Next emits no index of its own. /sitemap.xml still
    // works — next.config.ts redirects it here — but robots advertises the
    // real URL so crawlers don't spend a round trip on the hop.
    sitemap: [sitemapUrl, ...extraSitemaps],
  }
}
