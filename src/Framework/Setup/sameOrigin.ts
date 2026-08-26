/**
 * Same-origin enforcement for the one mutation that has no session to bind a
 * CSRF token to.
 *
 * WHY THE TOKEN IS NOT ENOUGH
 *
 * `FLOWCMS_SETUP_TOKEN` proves the caller knows a deployment secret. It says
 * nothing about who initiated the request. An operator who has the setup form
 * open in one tab and visits a hostile page in another is exactly the person
 * holding the token, and a cross-site form post carrying attacker-chosen owner
 * credentials would be submitted with the operator's own network position. The
 * token would not stop it, because the token is not the thing under attack.
 *
 * WHY NOT A CSRF COOKIE
 *
 * The usual answer — a signed double-submit cookie — needs a round trip to
 * issue and a secret to sign with, and would add a second pre-setup endpoint
 * whose only job is to hand out a token to anonymous callers. Origin checking
 * gets the same property for this endpoint from headers the browser sets and
 * script cannot forge.
 *
 * WHAT THIS ACCEPTS AND REFUSES
 *
 *   Origin matching the request's own host           accept
 *   Sec-Fetch-Site: same-origin, with no Origin      accept
 *   Origin from a different host                     refuse
 *   Neither header present                           refuse
 *
 * The last line is the important one. Refusing when both headers are absent
 * means a non-browser client (curl, a script, the future installer) must send
 * an Origin header to reach this endpoint. That is a deliberate, documented
 * cost: this is a browser form, it is reachable exactly once in an
 * installation's life, and defaulting to "allow when I cannot tell" is how
 * origin checks become decorative.
 */

export type OriginVerdict = "same-origin" | "cross-origin" | "indeterminate"

/**
 * Compare the request's Origin against the host it was actually sent to.
 *
 * The host comes from `x-forwarded-host` when present, then `host`. A reverse
 * proxy rewrites `host` to the internal upstream name while the browser's
 * Origin still names the public one, so preferring the forwarded value is what
 * makes this work behind the proxy every real deployment has.
 *
 * Only the HOST is compared, not the scheme. A deployment terminating TLS at a
 * proxy sees `https://example.com` as the Origin and forwards a plain HTTP
 * request whose headers carry no scheme at all; requiring a scheme match would
 * refuse every correct request in that very common topology while adding
 * nothing — an attacker who controls `http://example.com` already controls the
 * origin.
 */
export function classifyRequestOrigin(headers: Headers): OriginVerdict {
  const origin = headers.get("origin")?.trim()
  const host = (headers.get("x-forwarded-host") ?? headers.get("host"))?.trim()

  if (origin && origin !== "null") {
    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      // An unparseable Origin is not a same-origin request by any reading.
      return "cross-origin"
    }
    if (!host) return "indeterminate"
    return originHost.toLowerCase() === host.toLowerCase() ? "same-origin" : "cross-origin"
  }

  // No Origin header. Some browsers omit it on same-origin form posts, but
  // every browser that does sends Sec-Fetch-Site, so this is decidable.
  const fetchSite = headers.get("sec-fetch-site")?.trim().toLowerCase()
  if (fetchSite === "same-origin") return "same-origin"
  if (fetchSite === "cross-site" || fetchSite === "same-site" || fetchSite === "none") {
    // `same-site` is a different origin on the same registrable domain —
    // another subdomain — which is precisely a cross-origin request for this
    // purpose. `none` is a user typing the URL, which cannot be a form post.
    return "cross-origin"
  }

  return "indeterminate"
}

/** Fails closed: only an affirmative same-origin verdict passes. */
export function isSameOriginRequest(headers: Headers): boolean {
  return classifyRequestOrigin(headers) === "same-origin"
}
