import "server-only"
import { bingGet } from "./client"

/**
 * GetUserSites — shared by the connection-check route, the Overview screen,
 * and the Site Settings module, so it lives in its own file rather than
 * inside siteSettings.ts to avoid three call sites importing a "site
 * settings" file just for this one read.
 */
export interface BingSite {
  url: string
  isVerified: boolean
  /** Only meaningful while `isVerified` is false — the code to place in a
   *  meta tag/DNS record to verify ownership. Not used by this app's flow
   *  (it only connects to already-verified sites) but surfaced in case an
   *  admin needs to re-verify. */
  authenticationCode: string | null
}

export async function getUserSites(apiKey: string): Promise<BingSite[]> {
  const raw = await bingGet<Array<{ Url: string; IsVerified: boolean; AuthenticationCode: string | null }>>(
    "GetUserSites",
    apiKey,
    {}
  )
  return (raw ?? []).map((site) => ({
    url: site.Url,
    isVerified: site.IsVerified,
    authenticationCode: site.AuthenticationCode,
  }))
}
