import "server-only"

/**
 * Bing Webmaster Tools REST/JSON API — plain API key in the query string,
 * no SDK exists (unlike googleapis for GSC/PageSpeed), so this is a thin
 * fetch wrapper. Legacy SOAP/POX retire August 31, 2026; this integration
 * targets REST/JSON exclusively.
 *
 * Confirmed from Bing's own REST samples:
 *   GET  …/json/GetRankAndTrafficStats?siteUrl=…&apikey=…
 *   POST …/json/SubmitUrlbatch?apikey=…   body: {"siteUrl":"…","urlList":[…]}
 * Every JSON response wraps its payload as `{"d": …}`. A failed call returns
 * HTTP 400 with `{"ErrorCode":n,"Message":"…"}`.
 */

const BASE_URL = "https://ssl.bing.com/webmaster/api.svc/json"

export class BingApiError extends Error {
  code: number | null

  constructor(message: string, code: number | null = null) {
    super(message)
    this.name = "BingApiError"
    this.code = code
  }
}

interface BingEnvelope<T> {
  d: T
}

interface BingErrorBody {
  ErrorCode?: number
  Message?: string
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // Bing occasionally returns an empty or non-JSON body on success for
    // void methods (e.g. SubmitUrlBatch's `{"d":null}`) — an unparsable
    // body on a non-2xx response still falls through to the generic
    // message below.
  }

  if (!res.ok) {
    const err = body as BingErrorBody | null
    throw new BingApiError(
      err?.Message || `Bing Webmaster API request failed (${res.status})`,
      err?.ErrorCode ?? null
    )
  }

  return ((body as BingEnvelope<T> | null)?.d ?? null) as T
}

function buildUrl(method: string, apiKey: string, params: Record<string, string | undefined>): string {
  const url = new URL(`${BASE_URL}/${method}`)
  url.searchParams.set("apikey", apiKey)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }
  return url.toString()
}

/** GET methods — every parameter travels in the query string alongside
 *  `apikey`, per Bing's own REST samples. */
export async function bingGet<T>(
  method: string,
  apiKey: string,
  params: Record<string, string | undefined> = {}
): Promise<T> {
  const res = await fetch(buildUrl(method, apiKey, params), {
    method: "GET",
    headers: { Accept: "application/json" },
  })
  return parseResponse<T>(res)
}

/** POST methods (Submit*, Add*, Remove*, Save*, EnableDisable*) — `apikey`
 *  stays in the query string, the rest of the payload is a JSON body. */
export async function bingPost<T>(method: string, apiKey: string, body: unknown): Promise<T> {
  const res = await fetch(buildUrl(method, apiKey, {}), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  return parseResponse<T>(res)
}

/**
 * Every free-text String query parameter in Bing's JSON REST API is
 * JSON-quoted in the query string — confirmed from multiple methods'
 * Learn samples: `GetQueryTrafficStats?...&query=%22query1%22` and
 * `GetUrlInfo?...&url=%22example.com%22`. `siteUrl` is the one documented
 * exception — every sample sends it bare (`siteUrl=http://example.com`).
 * Skipping this on a String param produces a value Bing's WCF layer
 * doesn't parse the same way (it silently returns empty/wrong results
 * rather than erroring, so this is easy to miss without checking the
 * samples directly). Does NOT apply to numeric (Int16/UInt16) or
 * DateTime-typed params — call sites pass those through `bingGet`'s
 * `params` untouched.
 */
export function quoteBingString(value: string): string {
  return JSON.stringify(value)
}

/**
 * Bing serializes dates as `/Date(1316156400000-0700)/` (confirmed from
 * GetRankAndTrafficStats' sample response) — extracts the epoch
 * milliseconds and returns an ISO date (`YYYY-MM-DD`), matching the plain
 * date strings every other integration in this app already returns.
 */
export function parseBingDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const match = /\/Date\((-?\d+)/.exec(raw)
  if (!match) return null
  return new Date(Number(match[1])).toISOString().slice(0, 10)
}
