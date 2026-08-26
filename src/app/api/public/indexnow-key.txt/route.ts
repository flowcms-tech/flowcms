import { getSettingsRow } from "@/Framework/Settings/SettingsService"

/**
 * The IndexNow key file.
 *
 * Unauthenticated by design — the whole point is that Bing and friends can
 * fetch it to prove we control this host, so a session check here would break
 * the verification it exists for. The key is not a secret: it is a
 * challenge/response nonce, and knowing it only lets someone submit URLs on
 * this host that already resolve here.
 *
 * Referenced as `keyLocation` in every submission payload — see
 * src/Framework/Integrations/IndexNow.ts.
 */

export const dynamic = "force-dynamic"

export async function GET() {
  const row = await getSettingsRow()
  const key = row?.indexNowKey?.trim()

  // 404, not an empty 200: an empty key file verifies as a mismatch, which
  // reads in Bing's logs as "this site is misconfigured" rather than "this
  // site has not enabled IndexNow".
  if (!key) return new Response("Not found", { status: 404 })

  return new Response(key, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Must reflect a rotation immediately — a cached old key fails every
      // submission until the cache expires.
      "Cache-Control": "no-store",
    },
  })
}
