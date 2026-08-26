import { auth } from "@/Framework/Auth/auth"
import { canManageMenus, resolveRole } from "@/Framework/Auth/permissions"
import { getMenuAdminView } from "@/Modules/Appearance/Queries/menuAdminQueries"
import MenusModule from "@/Modules/Appearance/MenusModule"

/**
 * Appearance → Menus.
 *
 * Server-rendered for the same two reasons the Themes screen is: the list needs
 * no round trip before first paint, and the role check happens before any of it
 * is built — a contributor never receives the menu configuration, rather than
 * receiving it and being told not to look.
 *
 * The API enforces the same rule independently. This check is not the control;
 * it is what stops the page from being a data leak, and
 * `tests/appearance/menuAuthorization.test.ts` pins both halves.
 *
 * Never statically rendered: menus and the active theme are database reads.
 */
export const dynamic = "force-dynamic"

export default async function MenusPage() {
  const session = await auth()

  if (!canManageMenus(resolveRole(session?.user?.role))) {
    return (
      <div className="p-4">
        <h1 className="text-xl font-bold">Menus</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You do not have permission to manage menus.
        </p>
      </div>
    )
  }

  return <MenusModule initialView={await getMenuAdminView()} />
}
