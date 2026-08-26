import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

/**
 * SSRF guard for every outbound request FlowCMS makes on a user's behalf.
 *
 * THE THREAT
 *
 * The link checker fetches URLs pulled out of post content. Without a guard,
 * anyone who can put a link in a draft can make the server request an address
 * only the server can reach, and read the status code back out of the result
 * table. That is an internal port scanner with a UI. The prize target is
 * `169.254.169.254` — on AWS, GCP and Azure it serves instance credentials to
 * anything that asks from inside the instance.
 *
 * WHY STRING PREFIX CHECKS ARE NOT ENOUGH
 *
 * A `hostname.startsWith("127.")` test is defeated by all of:
 *
 *   - a hostname that RESOLVES to a private address (`localtest.me`, or simply
 *     an attacker's own DNS record pointing at 127.0.0.1);
 *   - IPv6 forms of the same address (`::1`, `::ffff:127.0.0.1`);
 *   - a public URL that REDIRECTS into the private range;
 *   - alternate literal encodings of an IPv4 address.
 *
 * So this resolves the hostname and checks the resolved addresses, and the
 * caller re-checks after every redirect hop.
 *
 * WHAT THIS DOES NOT CLAIM
 *
 * A DNS rebinding race remains theoretically possible: the name is resolved
 * here and resolved again by `fetch`, and a hostile authoritative server can
 * answer differently between the two. Closing that completely requires pinning
 * the connection to the address that was validated, which Node's `fetch` does
 * not expose. What narrows it in practice is that every hop is re-validated and
 * the TTL window is small. This is stated rather than papered over: the guard
 * raises the cost of the attack substantially, it does not reduce it to zero.
 */

/** Redirect hops permitted before a URL is abandoned. */
export const MAX_REDIRECTS = 3

export type UrlVerdict =
  | { ok: true; url: URL }
  | { ok: false; reason: string }

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"])

/**
 * Hostnames refused before any DNS lookup happens.
 *
 * Belt and braces: `localhost` normally resolves to a loopback address and
 * would be caught anyway, but a doctored `/etc/hosts` or a split-horizon
 * resolver can point it anywhere, and the name has no legitimate use in a link
 * inside published content.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
])

/** Parses and applies every check that does not need the network. */
export function parsePublicUrl(input: string): UrlVerdict {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return { ok: false, reason: "Not a valid absolute URL." }
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: `Unsupported scheme "${url.protocol}" — only http and https are checked.` }
  }

  if (!url.hostname) {
    return { ok: false, reason: "URL has no hostname." }
  }

  // `http://user:pass@evil.example@internal/` style confusion: different
  // parsers disagree about which side is the host. Nothing legitimate in
  // published content carries credentials, so refuse the whole class.
  if (url.username || url.password) {
    return { ok: false, reason: "URLs with embedded credentials are not checked." }
  }

  const hostname = normaliseHostname(url.hostname)
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: "Refusing to request a loopback or metadata hostname." }
  }

  return { ok: true, url }
}

/** Strips the brackets Node puts around an IPv6 literal, and lowercases. */
function normaliseHostname(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase()
}

function ipv4Blocked(ip: string): boolean {
  const parts = ip.split(".").map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // Not a well-formed dotted quad — treat as blocked rather than guessing.
    return true
  }
  const [a, b] = parts

  // Each entry is a range an attacker could use to reach something the public
  // internet cannot, or an address the network stack treats specially.
  if (a === 0) return true // "this network" / unspecified
  if (a === 10) return true // RFC1918
  if (a === 127) return true // loopback
  if (a === 100 && b >= 64 && b <= 127) return true // RFC6598 carrier-grade NAT
  if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
  if (a === 192 && b === 0) return true // IETF protocol assignments + TEST-NET-1
  if (a === 192 && b === 168) return true // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51) return true // TEST-NET-2
  if (a === 203 && b === 0) return true // TEST-NET-3
  if (a >= 224) return true // multicast, reserved, broadcast

  return false
}

function ipv6Blocked(ip: string): boolean {
  const lower = ip.toLowerCase()

  if (lower === "::" || lower === "::1") return true

  // IPv4-mapped and IPv4-compatible forms: ::ffff:127.0.0.1 is loopback with a
  // different spelling, and a guard that only pattern-matches the v6 text
  // misses it entirely.
  const mappedDotted = lower.match(/^::(?:ffff:(?:0{1,4}:)?)?(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mappedDotted) return ipv4Blocked(mappedDotted[1])

  // The SAME address after WHATWG URL normalisation, which rewrites the
  // embedded v4 part as two hex groups: `::ffff:127.0.0.1` arrives here as
  // `::ffff:7f00:1`. Without this branch the dotted check above is decorative,
  // because `new URL()` has already rewritten every such host before the guard
  // ever sees it.
  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16)
    const low = parseInt(mappedHex[2], 16)
    const dotted = [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".")
    return ipv4Blocked(dotted)
  }

  const firstHextet = lower.split(":")[0]
  if (firstHextet.length > 0) {
    const value = parseInt(firstHextet, 16)
    if (Number.isFinite(value)) {
      // fc00::/7 — unique local
      if ((value & 0xfe00) === 0xfc00) return true
      // fe80::/10 — link-local
      if ((value & 0xffc0) === 0xfe80) return true
    }
  }

  return false
}

/**
 * Whether an IP literal is one FlowCMS refuses to contact.
 *
 * Unknown or malformed input is treated as blocked. Failing closed is correct
 * here: a value this function cannot classify is a value nobody has reasoned
 * about, and the cost of a false positive is one unchecked link.
 */
export function isBlockedIpAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) return ipv4Blocked(ip)
  if (family === 6) return ipv6Blocked(ip)
  return true
}

/**
 * Full check: scheme, hostname, and every address the hostname resolves to.
 *
 * `lookup(..., { all: true })` because a hostname with several A/AAAA records
 * only needs ONE private address for the attack to work — checking the first
 * record and hoping is not a check.
 */
export async function assertPublicUrl(input: string): Promise<UrlVerdict> {
  const parsed = parsePublicUrl(input)
  if (!parsed.ok) return parsed

  const hostname = normaliseHostname(parsed.url.hostname)

  // A literal address needs no DNS round trip.
  if (isIP(hostname)) {
    return isBlockedIpAddress(hostname)
      ? { ok: false, reason: "Refusing to request a private, loopback, or reserved address." }
      : { ok: true, url: parsed.url }
  }

  let addresses: { address: string }[]
  try {
    addresses = await lookup(hostname, { all: true })
  } catch {
    return { ok: false, reason: "Hostname does not resolve." }
  }

  if (addresses.length === 0) {
    return { ok: false, reason: "Hostname does not resolve." }
  }

  for (const { address } of addresses) {
    if (isBlockedIpAddress(address)) {
      return {
        ok: false,
        reason: "Hostname resolves to a private, loopback, or reserved address.",
      }
    }
  }

  return { ok: true, url: parsed.url }
}

export interface SafeFetchOptions {
  method: "HEAD" | "GET"
  headers: Record<string, string>
  signal: AbortSignal
}

export class BlockedUrlError extends Error {}

/**
 * `fetch`, with the destination re-validated at every hop.
 *
 * `redirect: "manual"` is the whole point. With `redirect: "follow"`, the
 * platform chases the chain internally and the guard only ever sees the first
 * URL — so a public host that 302s to `http://169.254.169.254/` walks straight
 * through a check that looked thorough. Following the chain by hand is the only
 * way to apply `assertPublicUrl` to each destination.
 *
 * Throws `BlockedUrlError` when a hop is refused, so callers can report "we
 * declined to check this" distinctly from "the request failed".
 */
export async function safeFetch(
  initialUrl: string,
  options: SafeFetchOptions
): Promise<{ response: Response; redirected: boolean; finalUrl: string }> {
  let current = initialUrl
  let redirected = false

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const verdict = await assertPublicUrl(current)
    if (!verdict.ok) throw new BlockedUrlError(verdict.reason)

    const response = await fetch(verdict.url, {
      method: options.method,
      redirect: "manual",
      signal: options.signal,
      headers: options.headers,
      cache: "no-store",
    })

    const isRedirect = response.status >= 300 && response.status < 400
    const location = response.headers.get("location")
    if (!isRedirect || !location) {
      return { response, redirected, finalUrl: current }
    }

    // Relative Location headers are legal and common; resolve against the URL
    // that produced them before re-validating.
    current = new URL(location, verdict.url).toString()
    redirected = true
  }

  throw new BlockedUrlError(`More than ${MAX_REDIRECTS} redirects.`)
}
