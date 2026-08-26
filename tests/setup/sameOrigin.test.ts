import { describe, expect, it } from "vitest"
import { classifyRequestOrigin, isSameOriginRequest } from "@/Framework/Setup/sameOrigin"

/**
 * The CSRF control for the one mutation with no session to bind a token to.
 *
 * A setup token proves the caller KNOWS a deployment secret. It says nothing
 * about who initiated the request — and the person who knows the secret is
 * exactly the person a hostile page would ride. So origin is checked too.
 */

function headers(values: Record<string, string>): Headers {
  return new Headers(values)
}

describe("same-origin requests", () => {
  it("accepts an Origin matching the request host", () => {
    expect(
      classifyRequestOrigin(headers({ origin: "https://cms.example.test", host: "cms.example.test" })),
    ).toBe("same-origin")
  })

  it("prefers x-forwarded-host, because every real deployment has a proxy", () => {
    // The proxy rewrites `host` to the internal upstream name while the browser
    // still names the public one. Comparing against `host` alone would refuse
    // every correct request in the most common production topology.
    expect(
      classifyRequestOrigin(
        headers({
          origin: "https://cms.example.test",
          host: "upstream:3000",
          "x-forwarded-host": "cms.example.test",
        }),
      ),
    ).toBe("same-origin")
  })

  it("ignores the scheme, deliberately", () => {
    // TLS terminates at the proxy: the browser's Origin is https and the
    // forwarded request carries no scheme at all. Requiring a match would
    // refuse correct requests and buy nothing — whoever controls
    // http://example.com already controls the origin.
    expect(
      classifyRequestOrigin(headers({ origin: "http://cms.example.test", host: "cms.example.test" })),
    ).toBe("same-origin")
  })

  it("is case-insensitive on the host, as DNS is", () => {
    expect(
      classifyRequestOrigin(headers({ origin: "https://CMS.Example.Test", host: "cms.example.test" })),
    ).toBe("same-origin")
  })

  it("accepts Sec-Fetch-Site: same-origin when Origin is absent", () => {
    expect(classifyRequestOrigin(headers({ "sec-fetch-site": "same-origin" }))).toBe("same-origin")
  })
})

describe("requests that must be refused", () => {
  it("refuses a different host", () => {
    expect(
      classifyRequestOrigin(headers({ origin: "https://evil.example", host: "cms.example.test" })),
    ).toBe("cross-origin")
  })

  it("refuses a different PORT on the same hostname", () => {
    // A different port is a different origin, and on a shared host it can be a
    // different tenant entirely.
    expect(
      classifyRequestOrigin(headers({ origin: "https://cms.example.test:8443", host: "cms.example.test" })),
    ).toBe("cross-origin")
  })

  it("refuses a subdomain that merely shares the site", () => {
    expect(
      classifyRequestOrigin(headers({ origin: "https://blog.example.test", host: "cms.example.test" })),
    ).toBe("cross-origin")
    // Sec-Fetch-Site says `same-site` for exactly this case, and same-site is
    // not same-origin: another subdomain is another application.
    expect(classifyRequestOrigin(headers({ "sec-fetch-site": "same-site" }))).toBe("cross-origin")
  })

  it("refuses an opaque Origin", () => {
    // `Origin: null` is what a sandboxed iframe or a redirected cross-site POST
    // sends. It is the opposite of a reason to trust the request.
    expect(classifyRequestOrigin(headers({ origin: "null", host: "cms.example.test" }))).toBe(
      "indeterminate",
    )
    expect(isSameOriginRequest(headers({ origin: "null", host: "cms.example.test" }))).toBe(false)
  })

  it("refuses an unparseable Origin", () => {
    expect(classifyRequestOrigin(headers({ origin: "not a url", host: "cms.example.test" }))).toBe(
      "cross-origin",
    )
  })

  it("refuses Sec-Fetch-Site: cross-site", () => {
    expect(classifyRequestOrigin(headers({ "sec-fetch-site": "cross-site" }))).toBe("cross-origin")
  })

  it("is INDETERMINATE — and therefore refused — with no usable headers", () => {
    // Fails closed. A non-browser client must send an Origin header to reach
    // this endpoint, which is a documented cost: it is a browser form, used
    // once per installation, and "allow when I cannot tell" is how an origin
    // check becomes decorative.
    expect(classifyRequestOrigin(headers({ host: "cms.example.test" }))).toBe("indeterminate")
    expect(isSameOriginRequest(headers({ host: "cms.example.test" }))).toBe(false)
    expect(isSameOriginRequest(headers({}))).toBe(false)
  })

  it("refuses when Origin is present but the host is unknown", () => {
    expect(isSameOriginRequest(headers({ origin: "https://cms.example.test" }))).toBe(false)
  })
})
