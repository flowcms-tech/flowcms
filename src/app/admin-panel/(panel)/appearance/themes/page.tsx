import { auth } from "@/Framework/Auth/auth"
import { canManageAppearance, resolveRole } from "@/Framework/Auth/permissions"
import { getThemeAdminView } from "@/Modules/Appearance/Queries/themeAdminQueries"
import ThemesModule from "@/Modules/Appearance/ThemesModule"

/**
 * Appearance → Themes.
 *
 * Server-rendered, which buys two things. The theme list needs no round trip
 * before first paint, and the role check happens before any of it is built — an
 * editor never receives the operator's appearance configuration, rather than
 * receiving it and being told not to look.
 *
 * The API enforces the same rule independently. This check is not the control;
 * it is what stops the page from being a data leak, and
 * `tests/appearance/authorization.test.ts` pins both halves.
 *
 * Never statically rendered: which theme is active is a database read.
 */
export const dynamic = "force-dynamic"

export default async function ThemesPage() {
  const session = await auth()

  if (!canManageAppearance(resolveRole(session?.user?.role))) {
    return (
      <div className="p-4">
        <h1 className="text-xl font-bold">Themes</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Only an owner or admin can manage appearance.
        </p>
      </div>
    )
  }

  return <ThemesModule initialView={await getThemeAdminView()} />
}
