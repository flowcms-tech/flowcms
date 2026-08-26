import { cn, themeSettingsOf, type LayoutProps, type NavItem } from "flowcms/theme"
import { auroraSettings } from "./settings"

/**
 * The site shell.
 *
 * The only REQUIRED surface: a theme without a Layout has nothing to render
 * into, so the registry refuses it rather than falling back.
 *
 * Note what this component does not do. It does not query anything, does not
 * await anything, and does not read a global. Brand, navigation and settings
 * all arrive as props already resolved by core — which is what lets a theme be
 * an ordinary package with React as its only real dependency.
 *
 * THE TAILWIND CLASSES BELOW ARE PART OF THE PROOF, not decoration.
 *
 * Tailwind v4 discovers its sources by walking up from the application's
 * stylesheet and skips node_modules, so an installed theme's utilities are
 * purged unless the application registers the package with an `@source` line.
 * A theme whose markup loads and whose styling silently vanishes is not a
 * supported theme, and it fails in production only.
 *
 * `tracking-[0.4375em]` is deliberately an arbitrary-value utility that appears
 * nowhere else in FlowCMS. It cannot end up in the generated stylesheet by
 * coincidence — if it is there, Tailwind read this package.
 */
function NavList({ items }: { items: NavItem[] }) {
  if (items.length === 0) return null
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={`${item.href}-${item.label}`}>
          <a
            className="text-sm underline-offset-4 hover:underline"
            href={item.href}
            {...(item.opensInNewTab ? { target: "_blank", rel: "noopener" } : {})}
          >
            {item.label}
          </a>
          <NavList items={item.children} />
        </li>
      ))}
    </ul>
  )
}

export default function Layout({ brand, nav, settings, children }: LayoutProps) {
  // Narrowed with this theme's own definition, so `s.showAurora` is a boolean
  // and `s.headingStyle` is "plain" | "loud". No cast is written here.
  const s = themeSettingsOf(auroraSettings, settings)

  return (
    <div
      data-theme="aurora"
      data-heading={s.headingStyle}
      className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-4 py-10"
    >
      <header className="flex flex-col gap-3 border-b pb-6">
        {/* An operator-entered value rendered as a text child: React escapes
            it, and the theme does nothing special to make that true. */}
        {s.showAurora ? (
          <p
            data-aurora-banner="1"
            className="rounded-md px-3 py-2 text-xs uppercase tracking-[0.4375em]"
          >
            {s.bannerText}
          </p>
        ) : null}
        <h1 className={cn("text-2xl font-semibold", s.headingStyle === "loud" && "text-4xl font-black")}>
          {brand.siteName}
        </h1>

        {/* Only the slots this theme's manifest declares ever arrive. */}
        <nav aria-label="Primary" className="flex gap-4">
          <NavList items={nav.slots.primary ?? []} />
        </nav>
      </header>

      <aside aria-label="Sidebar" data-slot="sidebar" className="text-sm opacity-80">
        <NavList items={nav.slots.sidebar ?? []} />
      </aside>

      <main className="flex-1">{children}</main>

      <footer className="border-t pt-6 text-xs opacity-70">
        <p>{brand.siteName}</p>
      </footer>
    </div>
  )
}
