import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { canManageAppearance, resolveRole } from "@/Framework/Auth/permissions"
import { recordActivity } from "@/db/activityLog"
import { getThemeAdminView } from "@/Modules/Appearance/Queries/themeAdminQueries"
import {
  clearActiveTheme,
  getActiveThemeSlug,
  setActiveTheme,
} from "@/Framework/Settings/themeSelection"
import { DEFAULT_THEME_SLUG, isNoOpActivation } from "@/Themes/constants"

/**
 * Appearance → Themes.
 *
 * GET lists what is installed and what is rendering. POST activates a theme.
 *
 * The route is a TRANSPORT layer and nothing more. It authenticates, authorises,
 * validates that the request body has a string where a string belongs, and then
 * hands the decision to `setActiveTheme`, which is authoritative for slug
 * validity, installation and usability. Re-checking those here would produce two
 * sets of rules that drift — and the domain function is what Phase 6.3 already
 * proved against four database engines.
 */

/** Both verbs are admin: activating a theme changes every public page at once,
 *  and the listing reveals the operator's configuration. */
const FORBIDDEN = "Only an owner or admin can manage appearance"

/**
 * Transport validation only: is there a string here at all?
 *
 * Bounded so a multi-megabyte body cannot be pushed through to the domain
 * layer, and trimmed because a trailing space in a form field is not an error
 * worth showing anyone. What the string MEANS is `setActiveTheme`'s question.
 */
const activateSchema = z.object({
  slug: z.string().trim().min(1, "A theme must be selected").max(64, "Theme slug is too long"),
})

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  if (!canManageAppearance(resolveRole(gate.session.user.role))) {
    return NextResponse.json({ message: FORBIDDEN }, { status: 403 })
  }

  return NextResponse.json({ data: await getThemeAdminView(), message: "OK" })
}

export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  if (!canManageAppearance(resolveRole(session.user.role))) {
    return NextResponse.json({ message: FORBIDDEN }, { status: 403 })
  }

  const parsed = activateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 },
    )
  }

  const { slug } = parsed.data

  // Read before writing, for two reasons: the no-op check needs it, and a
  // successful activation should record what it replaced. Throws if the
  // database is unreachable — which is correct, and is why this is not wrapped:
  // an outage must not be reported as a successful activation.
  const previousSlug = await getActiveThemeSlug()

  if (isNoOpActivation(slug, previousSlug)) {
    // Idempotent. Clicking Activate on the theme already selected is not an
    // error — it is a user who wants to be sure. It writes nothing and logs
    // nothing: a second "activated" entry for a change that did not happen
    // makes the audit trail less trustworthy, not more.
    return NextResponse.json({
      data: { activeTheme: previousSlug ?? DEFAULT_THEME_SLUG, changed: false },
      message: "That theme is already active",
    })
  }

  if (slug === DEFAULT_THEME_SLUG) {
    // Normalised to NULL rather than stored literally, so "no explicit choice"
    // keeps one representation — see the column comment in
    // `src/db/schema/settings.ts`. This is also the recovery path out of a
    // fallback: it is what clears a stale selection pointing at a theme this
    // build no longer has.
    await clearActiveTheme()
  } else {
    const result = await setActiveTheme(slug)
    if (!result.ok) {
      // An expected refusal — unknown, malformed or unusable theme — not an
      // exception. 422 matches every other business-rule failure in this API.
      // The message is the domain layer's, written for an operator; it carries
      // no manifest, no registry internals and no stack trace.
      return NextResponse.json({ message: [result.error] }, { status: 422 })
    }
  }

  const activeTheme = slug === DEFAULT_THEME_SLUG ? DEFAULT_THEME_SLUG : slug

  // After the write and after cache invalidation, per the API conventions.
  // `recordActivity` never throws — the activation has already happened and
  // cannot be rolled back from here.
  await recordActivity({
    actor: session.user,
    action: "activated",
    entityType: "theme",
    entityId: activeTheme,
    entityLabel: activeTheme,
    // Names both ends, because "what was it before" is the question asked of an
    // entry like this. `previousSlug` comes from the database and may be a
    // stale or corrupt value; the activity log stores it as text and the log
    // screen renders it as text.
    summary: `Switched the public site theme from "${previousSlug ?? DEFAULT_THEME_SLUG}" to "${activeTheme}"`,
    metadata: { from: previousSlug, to: slug === DEFAULT_THEME_SLUG ? null : slug },
  })

  return NextResponse.json({
    data: { activeTheme, changed: true },
    message: `Theme "${activeTheme}" activated`,
  })
}
