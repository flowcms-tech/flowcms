import { redirect } from "next/navigation"
import { adminDashboardPath } from "@/Framework/Config/adminPath"

/**
 * The admin root: `/admin`, or whatever FLOWCMS_ADMIN_PATH names.
 *
 * The proxy has already done the two things that matter by the time this
 * renders. It refused the request if there was no session — the `authorized`
 * callback in auth.config.ts redirects anonymous visitors to the login page
 * before any rewrite happens — and it rewrote the public root onto this
 * internal one. So the only person who ever reaches this file is a signed-in
 * operator who typed, bookmarked or was linked to the bare admin path, and the
 * only sensible answer for them is the dashboard.
 *
 * Without this page, that visitor got the site's 404: the rewrite target was a
 * directory with no `page.tsx`. The gap was invisible to fresh installs because
 * they arrive unauthenticated and are redirected to login instead.
 *
 * It sits OUTSIDE the `(panel)` route group on purpose. The panel layout reads
 * the session and three settings records before rendering anything, and a
 * page whose entire body is a redirect has no reason to pay for a shell it
 * will never show.
 *
 * The target is the PUBLIC dashboard path, built through `adminDashboardPath()`
 * rather than spelled out, so moving the panel moves this redirect with it.
 * `tests/navigation/adminRootRedirect.test.ts` pins both halves.
 */
export default function AdminRootPage(): never {
  redirect(adminDashboardPath())
}
