import type {
  BlogIndexView,
  FlowCMSTheme,
  LayoutProps,
  ThemeManifest,
  ThemeSurfaceProps,
} from "@/Themes/contract"
import { JsonLd, defineThemeSettings, themeSettingsOf } from "@/Themes/contract"

/**
 * Settings that exist only to be observed in a test.
 *
 * Unmistakably test-only, like the theme itself: a marker suffix that appears
 * in the rendered marker string, and a switch that removes a visible element.
 * Both are trivially assertable in HTML and neither has any product meaning.
 */
export const integrationThemeSettings = defineThemeSettings({
  version: 1,
  fields: [
    {
      key: "markerSuffix",
      type: "text",
      label: "Marker suffix",
      description: "Appended to the integration marker so a test can see the value change.",
      default: "",
      maxLength: 80,
    },
    {
      key: "showBanner",
      type: "boolean",
      label: "Show the banner",
      default: true,
    },
  ],
})

/**
 * A second theme, existing only so that theme SWITCHING can be proved against
 * the real resolver rather than against a mocked one.
 *
 * Deliberately minimal and deliberately ugly: it exists to be told apart from
 * the default theme in one grep of the rendered HTML, and to be a partial theme
 * so per-surface fallback is exercised at the same time. It implements Layout
 * and BlogIndex and nothing else.
 *
 * It is NOT registered unless `FLOWCMS_INTEGRATION_THEMES=1` is set — see
 * `./index.ts` for why that gate is a runtime env check rather than a separate
 * build.
 */

export const manifest: ThemeManifest = {
  slug: "integration",
  name: "FlowCMS Integration Test Theme",
  version: "1.0.0",
  flowcmsCompat: "*",
  menuSlots: ["primary"],
  description: "Internal. Used to verify theme switching; not a theme to install.",
}

/** The string every assertion looks for. */
export const INTEGRATION_MARKER = "flowcms-integration-theme"

/** The marker every navigation assertion looks for. */
export const INTEGRATION_NAV_MARKER = "flowcms-integration-nav"

function Layout({ brand, nav, settings, children }: LayoutProps) {
  const s = themeSettingsOf(integrationThemeSettings, settings)
  // Deliberately renders ONLY `primary` — the one slot this theme's manifest
  // declares. Rendering `footer` as well would make the slot-filtering proof
  // meaningless: the point is that a theme receives the slots it asked for and
  // no others, and that switching themes changes which menus are consumed
  // without touching a stored row.
  const primary = nav.slots.primary ?? []

  return (
    <div data-theme={manifest.slug}>
      <header>
        {s.showBanner ? (
          <p data-banner="1">
            {INTEGRATION_MARKER}
            {s.markerSuffix ? `:${s.markerSuffix}` : ""}
          </p>
        ) : null}
        <h1>{brand.siteName}</h1>
        <nav data-nav={INTEGRATION_NAV_MARKER} data-slot="primary" data-count={primary.length}>
          <ul>
            {primary.map((item) => (
              <li key={`${item.href}-${item.label}`}>
                <a
                  href={item.href}
                  {...(item.opensInNewTab ? { target: "_blank", rel: "noopener" } : {})}
                >
                  {item.label}
                </a>
                {item.children.length > 0 && (
                  <ul>
                    {item.children.map((child) => (
                      <li key={`${child.href}-${child.label}`}>
                        <a
                          href={child.href}
                          {...(child.opensInNewTab ? { target: "_blank", rel: "noopener" } : {})}
                        >
                          {child.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  )
}

function BlogIndex({ posts, page, totalPages, jsonLd }: ThemeSurfaceProps<BlogIndexView>) {
  return (
    <section>
      <JsonLd data={jsonLd} />
      <h2>{INTEGRATION_MARKER}: blog</h2>
      <ul>
        {posts.map((post) => (
          <li key={post.id}>
            <a href={`/blog/${post.slug}`}>{post.title}</a>
          </li>
        ))}
      </ul>
      <p>
        Page {page} of {totalPages}
      </p>
    </section>
  )
}

export const integrationTheme: FlowCMSTheme = {
  manifest,
  settings: integrationThemeSettings,
  Layout,
  BlogIndex,
}
