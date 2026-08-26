import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db/client"
import { settings } from "@/db/tables"
import { SETTINGS_SINGLETON_ID } from "@/db/schema/settings"
import { getBaseUrl, invalidateSettingsCache } from "@/Framework/Settings/SettingsService"
import { generateIndexNowKey, INDEXNOW_KEY_PATH } from "@/Framework/Integrations/IndexNow"
import { canManageSettings, resolveRole } from "@/Framework/Auth/permissions"
import { requireApiAuth } from "@/Framework/Auth/apiAuth"
import { upsert } from "@/db/writes"

/**
 * Generates or rotates the IndexNow key.
 *
 * A rotation is not free: the new key only starts verifying once the engines
 * refetch `keyLocation`, so submissions made in that window can be rejected.
 * That is still the right trade for a key that is not a secret, and it is why
 * there is no "clear the key" action here — turning the feature off is what
 * `indexNowEnabled` is for.
 */
export async function POST(request: NextRequest) {
  const gate = await requireApiAuth(request)
  if (!gate.ok) return gate.response
  const { session } = gate
  // Rotating the key breaks in-flight submissions until the engines refetch
  // keyLocation — an integration decision, not an editorial one.
  if (!canManageSettings(resolveRole(session.user.role))) {
    return NextResponse.json(
      { message: "Only an owner or admin can manage integrations" },
      { status: 403 }
    )
  }

  const indexNowKey = generateIndexNowKey()

  await upsert(
    settings,
    { id: SETTINGS_SINGLETON_ID, indexNowKey, updatedAt: new Date() },
    { target: settings.id, set: { indexNowKey, updatedAt: new Date() } },
  )

  await invalidateSettingsCache()

  const base = await getBaseUrl()

  return NextResponse.json({
    data: { indexNowKey, keyLocation: `${base}${INDEXNOW_KEY_PATH}` },
    message: "IndexNow key generated",
  })
}
