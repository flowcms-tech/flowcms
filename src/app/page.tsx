import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getSetupStatus } from "@/Framework/Setup/setupState"
import { getBrand } from "@/Framework/Settings/SettingsService"
import { buildHomeView } from "@/Modules/Public/ViewModels"
import ThemeShell from "@/Modules/Public/Components/ThemeShell"
import { resolveSurface } from "@/Themes/resolver"

/**
 * The site root.
 *
 * The route resolves the view model; the ThemeResolver decides what renders it.
 * Nothing here names a theme — Phase 6.3 changes which theme is selected
 * without this file being touched.
 *
 * Metadata stays here. `generateMetadata` is a Next.js route export a component
 * cannot provide, and titles and descriptions are SEO, which core owns.
 */

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand()
  return {
    title: brand.siteName,
    ...(brand.tagline ? { description: brand.tagline } : {}),
  }
}

export default async function HomePage() {
  /**
   * FIRST-RUN DISCOVERY.
   *
   * An operator who has just deployed FlowCMS opens the site root. If the
   * installation has never been initialized, that is where they find out — one
   * redirect, no documentation lookup, no guessing at a URL.
   *
   * WHY HERE AND NOT IN `src/proxy.ts`. The proxy runs on nearly every request
   * and must never transitively import the database client; Phase 3's design
   * note is explicit that a blog post pays one string comparison and leaves.
   * Adding a settings query there would put a database round trip in front of
   * every image, page and asset in order to answer a question that matters once
   * in an installation's life.
   *
   * WHY ONLY HERE. This is the site's HTML entry point. Sitemaps, RSS,
   * `robots.txt`, `/api/health` and `/api/ready` are untouched — an XML client
   * redirected to an HTML form gets a parse error instead of a feed, and an
   * orchestrator redirected instead of answered marks the container unhealthy.
   *
   * Only a DEFINITE `incomplete` redirects. `blocked` means the database could
   * not be read, and a live production home page must not turn into a first-run
   * form during an outage.
   */
  if ((await getSetupStatus()).state === "incomplete") redirect("/setup")

  const [{ Component: Home, settings }, view] = await Promise.all([
    resolveSurface("Home"),
    buildHomeView(),
  ])

  return (
    <ThemeShell>
      <Home {...view} settings={settings} />
    </ThemeShell>
  )
}
