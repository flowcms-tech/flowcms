import "server-only"

import { getBaseUrl, getSettingsRow } from "@/Framework/Settings/SettingsService"

/**
 * IndexNow — the fastest honest way to tell Bing, Yandex, Seznam, and Naver
 * that a URL changed. Free, no OAuth, one POST. (Google does not participate,
 * which is what the sitemap is for.)
 *
 * Submitting to api.indexnow.org rather than a single engine's endpoint is
 * deliberate: the participating engines share submissions between themselves,
 * so one call reaches all of them.
 */

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow"

/**
 * The key is served here instead of at `/{key}.txt` on the origin root, which
 * would mean fighting Next's router for a file whose name is only known at
 * runtime. The IndexNow spec supports `keyLocation` for exactly this case.
 */
export const INDEXNOW_KEY_PATH = "/api/public/indexnow-key.txt"

/** Short on purpose. A search-engine ping must never be what makes an
 *  editor's save feel slow, let alone what makes it fail. */
const TIMEOUT_MS = 4000

/** The protocol's per-request cap. */
const MAX_URLS = 10000

/** No hyphens: the spec wants 8–128 hexadecimal-ish characters, and a UUID
 *  with its dashes stripped is exactly that with no extra entropy source. */
export function generateIndexNowKey(): string {
  return crypto.randomUUID().replace(/-/g, "")
}

/**
 * Notifies IndexNow that `urls` changed. Fires on publish, on substantive
 * update, on unpublish/trash, and on a slug change (both the old and the new
 * URL).
 *
 * Never throws and never rejects. Callers are expected to `void` this or await
 * it without a try/catch — a failed notification is not a failed save, and the
 * only correct response to one is a log line.
 */
export async function submitToIndexNow(urls: string[]): Promise<void> {
  try {
    const [row, base] = await Promise.all([getSettingsRow(), getBaseUrl()])

    if (!row?.indexNowEnabled) return
    const key = row.indexNowKey?.trim()
    if (!key) return

    const host = new URL(base).host

    // IndexNow rejects the whole payload if any URL is on a different host,
    // so a stray absolute URL from another origin would silently cost us
    // every other URL in the batch.
    const urlList = Array.from(
      new Set(
        urls
          .map((url) => url.trim())
          .filter((url) => {
            if (!url) return false
            try {
              return new URL(url).host === host
            } catch {
              return false
            }
          })
      )
    ).slice(0, MAX_URLS)

    if (urlList.length === 0) return

    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `${base}${INDEXNOW_KEY_PATH}`,
        urlList,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Nothing about this response is worth caching or reusing.
      cache: "no-store",
    })

    if (!response.ok) {
      // 403 means the key file didn't verify; 422 means a URL/host mismatch.
      // Both are configuration problems the owner has to fix, and both are
      // invisible unless they are logged here.
      console.warn(`[IndexNow] ${response.status} ${response.statusText} for ${urlList.length} URL(s)`)
    }
  } catch (error) {
    console.warn("[IndexNow] submission failed:", error)
  }
}
