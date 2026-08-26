import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { canManageAppearance, resolveRole } from "@/Framework/Auth/permissions"
import { recordActivity } from "@/db/activityLog"
import {
  getThemeSettings,
  resetThemeSettings,
  setThemeSettings,
} from "@/Framework/Settings/themeSettings"
import { getThemeSettingsAdminView } from "@/Modules/Appearance/Queries/themeSettingsAdminQueries"

/**
 * Appearance → Theme Settings.
 *
 * GET returns the screen. PUT replaces one theme's values. DELETE resets a
 * theme to its declared defaults.
 *
 * TRANSPORT ONLY. It authenticates, authorises, checks that the body has a
 * string where a string belongs, and hands the decision to `setThemeSettings`,
 * which is authoritative for slug validity, installation, availability, field
 * existence, value validity and payload size. Re-checking those here would
 * produce two sets of rules that drift.
 *
 * NONE OF THESE VERBS ACTIVATES A THEME. Configuring a theme you have not
 * switched to is the point; `settings.activeTheme` is never touched from here.
 */

const FORBIDDEN = "Only an owner or admin can manage appearance"

/** Transport shape only. What a value MEANS is the domain layer's question. */
const saveSchema = z.object({
  theme: z.string().trim().min(1, "A theme must be selected").max(64, "Theme slug is too long"),
  // Bounded at the transport edge so a multi-megabyte body cannot reach the
  // domain layer; the exact byte ceiling is enforced there, on the serialised
  // form, which is the thing actually stored.
  values: z.record(z.string().max(64), z.union([z.string().max(8000), z.number(), z.boolean()])),
})

const themeParam = z.string().trim().min(1).max(64)

export async function GET(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  if (!canManageAppearance(resolveRole(gate.session.user.role))) {
    return NextResponse.json({ message: FORBIDDEN }, { status: 403 })
  }

  const requested = new URL(request.url).searchParams.get("theme") ?? undefined
  return NextResponse.json({ data: await getThemeSettingsAdminView(requested), message: "OK" })
}

export async function PUT(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  if (!canManageAppearance(resolveRole(session.user.role))) {
    return NextResponse.json({ message: FORBIDDEN }, { status: 403 })
  }

  const parsed = saveSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues.map((issue) => issue.message) },
      { status: 422 },
    )
  }

  const { theme, values } = parsed.data

  // Read before writing so the activity entry can name which fields moved.
  const before = await getThemeSettings(theme)

  const result = await setThemeSettings(theme, values)
  if (!result.ok) {
    // An expected refusal — unknown field, bad value, uninstalled theme — not
    // an exception. 422 matches every other business-rule failure in this API.
    return NextResponse.json({ message: [result.error] }, { status: 422 })
  }

  if (!result.changed) {
    // Idempotent. Nothing written and nothing logged: a "settings updated"
    // entry for a save that changed nothing makes the trail less trustworthy.
    return NextResponse.json({ data: { theme, changed: false }, message: "No changes" })
  }

  const after = await getThemeSettings(theme)
  // FIELD NAMES, NEVER VALUES. A settings value is free-form operator text and
  // the activity log has a wider audience than this screen; naming the field is
  // what an operator needs to answer "what changed", and it is all they get.
  const changedFields = Object.keys(after.values).filter(
    (key) => before.values[key] !== after.values[key],
  )

  await recordActivity({
    actor: session.user,
    action: "updated",
    entityType: "theme_settings",
    entityId: theme,
    entityLabel: theme,
    summary:
      changedFields.length > 0
        ? `Changed ${changedFields.join(", ")} in the "${theme}" theme's settings`
        : `Saved the "${theme}" theme's settings`,
    metadata: { theme, fields: changedFields },
  })

  return NextResponse.json({ data: { theme, changed: true }, message: "Theme settings saved" })
}

export async function DELETE(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate

  if (!canManageAppearance(resolveRole(session.user.role))) {
    return NextResponse.json({ message: FORBIDDEN }, { status: 403 })
  }

  const parsed = themeParam.safeParse(new URL(request.url).searchParams.get("theme"))
  if (!parsed.success) {
    return NextResponse.json({ message: ["A theme must be selected"] }, { status: 422 })
  }

  const theme = parsed.data
  const result = await resetThemeSettings(theme)
  if (!result.ok) {
    return NextResponse.json({ message: [result.error] }, { status: 422 })
  }

  if (!result.changed) {
    // Already at defaults. No row to delete, so nothing happened.
    return NextResponse.json({ data: { theme, changed: false }, message: "Already at defaults" })
  }

  await recordActivity({
    actor: session.user,
    action: "deleted",
    entityType: "theme_settings",
    entityId: theme,
    entityLabel: theme,
    summary: `Reset the "${theme}" theme's settings to its defaults`,
    metadata: { theme },
  })

  return NextResponse.json({ data: { theme, changed: true }, message: "Theme settings reset" })
}
