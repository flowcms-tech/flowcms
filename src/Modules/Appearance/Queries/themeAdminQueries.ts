import "server-only"
import { listInstalledThemes } from "@/Themes/registry"
import { getThemeStatus } from "@/Themes/resolver"
import { buildThemeAdminView, type ThemeAdminView } from "../Values/themeAdminView"

/**
 * The Appearance screen's data, assembled server-side.
 *
 * `server-only` is load-bearing rather than decorative: `listInstalledThemes()`
 * returns registry entries holding React components, and importing this module
 * from a client component would pull every installed theme into the browser
 * bundle. The build fails instead.
 *
 * Nothing here decides anything. What is installed comes from the registry,
 * what is rendering comes from the resolver, and shaping them into something
 * serialisable is `buildThemeAdminView`'s pure job — which is why every
 * operator-visible state can be tested without a database.
 */
export async function getThemeAdminView(): Promise<ThemeAdminView> {
  return buildThemeAdminView(listInstalledThemes(), await getThemeStatus())
}
