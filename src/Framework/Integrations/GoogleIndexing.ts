import "server-only"

import { google } from "googleapis"
import { getGscConfig, getGscRedirectUri, getSettingsRow } from "@/Framework/Settings/SettingsService"
import { buildOAuthClient } from "./GoogleSearchConsole"

/**
 * Google Indexing API.
 *
 * READ THIS BEFORE ENABLING IT. Google's Indexing API is officially supported
 * for exactly two content types: `JobPosting` and `BroadcastEvent`. Using it
 * for blog posts is outside its documented scope, Google has said so
 * repeatedly, and any effect it appears to have is a side effect that can stop
 * at any time. It is not a faster route into the index and it is not a
 * substitute for anything.
 *
 * The recommended path is IndexNow (src/Framework/Integrations/IndexNow.ts)
 * plus a correct sitemap. That is what actually works.
 *
 * This exists because the OAuth plumbing was already here for Search Console
 * and the incremental cost was one file — it ships **disabled by default**,
 * behind `settings.googleIndexingApiEnabled`, and the settings UI repeats the
 * paragraph above rather than hiding it in a comment. Do not describe this
 * feature to a user as something that will get their posts indexed.
 */

/** Distinct from the Search Console scope. An account connected before this
 *  existed has a refresh token minted without it, and calls will fail with an
 *  insufficient-scope error until the owner reconnects. */
export const GOOGLE_INDEXING_SCOPE = "https://www.googleapis.com/auth/indexing"

/** Same reasoning as IndexNow's timeout: a publish must never block on, or
 *  fail because of, a notification nobody is waiting for. */
const TIMEOUT_MS = 5000

/** Google's documented per-project daily quota is 200 URLs; batching more
 *  than this in one call just wastes it faster. */
const MAX_URLS = 100

export type IndexingNotificationType = "URL_UPDATED" | "URL_DELETED"

/**
 * Publishes a URL-change notification per URL.
 *
 * Never throws. Like `submitToIndexNow`, the only correct response to a
 * failure here is a log line — see the caveat at the top of this file for why
 * a failure is not even necessarily a problem.
 */
export async function submitToGoogleIndexing(
  urls: string[],
  type: IndexingNotificationType
): Promise<void> {
  try {
    const [row, gsc, redirectUri] = await Promise.all([
      getSettingsRow(),
      getGscConfig(),
      getGscRedirectUri(),
    ])

    if (!row?.googleIndexingApiEnabled) return
    if (!gsc.clientId || !gsc.clientSecret || !gsc.refreshToken) return

    const targets = Array.from(new Set(urls.map((url) => url.trim()).filter(Boolean))).slice(
      0,
      MAX_URLS
    )
    if (targets.length === 0) return

    const client = buildOAuthClient({
      clientId: gsc.clientId,
      clientSecret: gsc.clientSecret,
      redirectUri,
    })
    client.setCredentials({ refresh_token: gsc.refreshToken })

    const indexing = google.indexing({ version: "v3", auth: client })

    // Sequential, not Promise.all: the API is quota-limited per project and a
    // burst of parallel calls is the fastest way to spend a day's quota on
    // 429s. A handful of URLs per publish makes the latency irrelevant.
    for (const url of targets) {
      try {
        // The timeout is a transport option, not part of the request body.
        await indexing.urlNotifications.publish({ requestBody: { url, type } }, { timeout: TIMEOUT_MS })
      } catch (error) {
        console.warn(`[GoogleIndexing] ${type} failed for ${url}:`, error)
      }
    }
  } catch (error) {
    console.warn("[GoogleIndexing] submission failed:", error)
  }
}
