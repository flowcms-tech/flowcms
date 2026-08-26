import Link from "next/link"
import { themeSettingsOf, type LayoutProps, type NavItem } from "@/Themes/contract"
import { defaultThemeSettings, LAYOUT_WIDTH_CLASS } from "./settings"

/**
 * The public shell.
 *
 * New in Phase 6.1 — FlowCMS had no public layout before, only the root layout
 * shared with the admin panel — so nothing was duplicated to create it. It is
 * NOT yet wired into `src/app`; route dispatch is Phase 6.2. Until then it
 * exists to be rendered by tests and by theme authors reading the contract.
 *
 * Every navigation slot is empty until the Menu subsystem lands in 6.5, so the
 * header and footer must read correctly with no links at all. That is why the
 * site name is a plain heading with a home link rather than the first item of a
 * nav bar that currently has no items.
 */

function NavList({ items, className }: { items: NavItem[]; className?: string }) {
  if (items.length === 0) return null

  return (
    <ul className={className}>
      {items.map((item) => (
        <li key={`${item.href}-${item.label}`}>
          <Link
            href={item.href}
            {...(item.opensInNewTab ? { target: "_blank", rel: "noopener" } : {})}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {item.label}
          </Link>
          {/* One level of children. Deeper trees are a menu-editor concern,
              not something this theme pretends to render. */}
          <NavList items={item.children} className="ml-3 flex flex-col gap-1" />
        </li>
      ))}
    </ul>
  )
}

export default function Layout({ brand, nav, settings, children }: LayoutProps) {
  // Narrowed with the theme's own definition, so `s.showTagline` is a boolean
  // rather than a union. No cast in theme code — the contract owns that.
  const s = themeSettingsOf(defaultThemeSettings, settings)
  const width = LAYOUT_WIDTH_CLASS[s.layoutWidth] ?? LAYOUT_WIDTH_CLASS.normal

  return (
    <div
      className="flex min-h-screen flex-col"
      // The colour reached here through `isSafeColor`, so it is `#RGB`,
      // `#RRGGBB` or `#RRGGBBAA` and nothing else — it cannot carry a second
      // declaration, a `url()` or a `var()`. React would escape a quote anyway;
      // the validation is what stops a valid-looking CSS payload.
      style={{ ["--theme-accent" as string]: s.accentColor }}
    >
      <header className="border-b border-border">
        <div
          className={`${width} mx-auto flex w-full flex-wrap items-center justify-between gap-4 px-4 py-4`}
        >
          <Link href="/" className="flex items-center gap-3">
            {brand.logoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element -- served by
                 our own public image route, not an optimizable remote pattern */
              <img
                src={brand.logoUrl}
                alt={brand.logoAltText ?? brand.siteName}
                className="h-8 w-auto object-contain"
              />
            ) : (
              <span className="flex flex-col">
                <span className="text-lg font-semibold">{brand.siteName}</span>
                {/* Rendered as a text child, so an operator's tagline is
                    escaped by React like any other untrusted string. */}
                {s.showTagline && brand.tagline ? (
                  <span className="text-sm text-muted-foreground">{brand.tagline}</span>
                ) : null}
              </span>
            )}
          </Link>

          <nav aria-label="Primary">
            <NavList items={nav.slots.primary ?? []} className="flex flex-wrap gap-4" />
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className={`${width} mx-auto flex w-full flex-col gap-3 px-4 py-8`}>
          <nav aria-label="Footer">
            <NavList items={nav.slots.footer ?? []} className="flex flex-wrap gap-4" />
          </nav>
          <p className="text-sm text-muted-foreground">{brand.siteName}</p>
        </div>
      </footer>
    </div>
  )
}
