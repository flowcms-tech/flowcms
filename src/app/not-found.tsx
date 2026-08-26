import NotFoundReporter from "@/Modules/Public/Components/NotFoundReporter"
import { buildNotFoundView } from "@/Modules/Public/ViewModels"
import { resolveSurface } from "@/Themes/resolver"

/**
 * The 404 page.
 *
 * Two halves, deliberately. `NotFoundReporter` is core: it posts the miss to
 * `/api/public/404-log`, which fills the broken-link report in the admin panel,
 * and that must keep working whichever theme is installed. The presentation is
 * the theme's, resolved through the ThemeResolver like every other surface.
 *
 * NOT WRAPPED IN `ThemeShell`, and this is the one deliberate exception.
 * The NotFound surface is a full-bleed page in the default theme — its own
 * background, its own vertical centring — so putting a site header above it and
 * a footer below it would be a visual redesign, which is not what a dispatch
 * refactor is for. The 404 is also the surface that has to work when something
 * else has already failed, and the shell is another thing that can fail: it
 * reads Settings. Keeping the 404 independent of it is the conservative choice.
 * `tests/themes/routeDispatch.test.tsx` pins the exception so it stays
 * deliberate; revisiting it belongs with the 404's other open question (see the
 * SSR note in the Phase 6.1 report).
 *
 * `buildNotFoundView` swallows Settings failures and falls back to the product
 * name, for the same reason.
 */
export default async function NotFoundPage() {
  const [{ Component: NotFound, settings }, view] = await Promise.all([
    resolveSurface("NotFound"),
    buildNotFoundView(),
  ])

  return (
    <>
      <NotFoundReporter />
      <NotFound {...view} settings={settings} />
    </>
  )
}
