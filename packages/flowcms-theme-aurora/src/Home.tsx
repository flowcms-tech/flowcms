import { JsonLd, themeSettingsOf, type HomeView, type ThemeSurfaceProps } from "flowcms/theme"
import { auroraSettings } from "./settings"

/**
 * The site root.
 *
 * `view.jsonLd` arrives already built by core. The theme decides whether and
 * where to render it — it never authors a graph of its own, because a theme
 * that could would be publishing claims about the operator's business that the
 * operator never made.
 */
export default function Home({ brand, jsonLd, settings }: ThemeSurfaceProps<HomeView>) {
  const s = themeSettingsOf(auroraSettings, settings)

  return (
    <section data-surface="aurora-home">
      <JsonLd data={jsonLd} />
      <h2>{s.headingStyle === "loud" ? brand.siteName.toUpperCase() : brand.siteName}</h2>
      {brand.tagline ? <p>{brand.tagline}</p> : null}
    </section>
  )
}
