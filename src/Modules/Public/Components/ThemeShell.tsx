import type { ReactNode } from "react"
import { resolveLayoutAndSlots } from "@/Themes/resolver"
import { getBrandView } from "../ViewModels"
import { getNavView } from "../ViewModels/nav"

/**
 * The wrapper every public HTML surface renders inside.
 *
 * CORE-OWNED, and it does three jobs a theme must not be trusted with:
 *
 *   1. It resolves the Layout through the ThemeResolver, so no route names a
 *      theme.
 *   2. It builds `brand` and `nav` and passes them in. The Layout is a pure
 *      component — it never reads Settings or the database itself, because a
 *      theme that can query is a theme that can be slow, wrong, or leak a
 *      storage key into markup.
 *   3. It applies `.public-surface`.
 *
 * That third one is the reason this is a component and not a route-group
 * layout. `.public-surface` pins the public site to its own colour tokens so a
 * visitor sees the same page whichever scheme an admin picked for their own
 * panel (see the PUBLIC SITE block in globals.css). During Phase 6.1 the class
 * briefly moved into the theme's Layout, and `/` silently began inheriting the
 * admin's theme cookie — the page still rendered, in the wrong palette, which
 * is exactly why review missed it. It is core's, applied in exactly one place,
 * outside the theme, and pinned by `tests/architecture/themeBoundaries.test.ts`.
 *
 * A theme can still own its palette: it redefines the tokens inside its own
 * markup. What it cannot do is forget the boundary and silently inherit the
 * admin's.
 *
 * WHY NOT A ROUTE-GROUP LAYOUT. Moving the public routes into `src/app/(public)/`
 * would apply this automatically and be the idiomatic Next answer. It also
 * changes which `not-found.tsx` handles a `notFound()` from the root catch-all,
 * and 6.2 was a dispatch refactor that was supposed to leave behaviour alone.
 * An explicit wrapper is one line per route and cannot move the routing tree;
 * an architecture test enforces that no public HTML route forgets it.
 *
 * NAVIGATION (Phase 6.5). The shell asks the RENDERING theme which slots it
 * declares, then asks core for exactly those. This is the single place menus
 * are read for the public site, and it is why switching themes changes which
 * menus appear without touching a row: a theme is handed the slots it declared
 * and no others, and nothing on this path writes.
 *
 * Brand and navigation are fetched concurrently — they share no data, and a
 * page should not wait for one to finish before starting the other. `nav`
 * depends on the resolved theme, so that resolution comes first.
 */
export default async function ThemeShell({ children }: { children: ReactNode }) {
  const { Layout, slots, settings } = await resolveLayoutAndSlots()
  const [brand, nav] = await Promise.all([getBrandView(), getNavView(slots)])

  return (
    <div className="public-surface">
      <Layout brand={brand} nav={nav} settings={settings}>
        {children}
      </Layout>
    </div>
  )
}
