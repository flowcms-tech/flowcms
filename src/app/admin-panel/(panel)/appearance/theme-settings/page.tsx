import { auth } from "@/Framework/Auth/auth"
import { canManageAppearance, resolveRole } from "@/Framework/Auth/permissions"
import { getThemeSettingsAdminView } from "@/Modules/Appearance/Queries/themeSettingsAdminQueries"
import ThemeSettingsModule from "@/Modules/Appearance/ThemeSettingsModule"

/**
 * Appearance → Theme Settings.
 *
 * Server-rendered, and the role check happens before any of it is built — an
 * editor never receives the operator's theme configuration, rather than
 * receiving it and being told not to look. The API enforces the same rule
 * independently; this check is what stops the page being a data leak.
 *
 * Defaults to the theme currently RENDERING, which is also the right answer
 * during a fallback: the selected theme's package is absent, so it has no
 * definition to render a form from.
 *
 * Never statically rendered: which theme renders, and its values, are database
 * reads.
 */
export const dynamic = "force-dynamic"

export default async function ThemeSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string }>
}) {
  const session = await auth()

  if (!canManageAppearance(resolveRole(session?.user?.role))) {
    return (
      <div className="p-4">
        <h1 className="text-xl font-bold">Theme Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Only an owner or admin can manage appearance.
        </p>
      </div>
    )
  }

  const { theme } = await searchParams
  return <ThemeSettingsModule initialView={await getThemeSettingsAdminView(theme)} />
}
