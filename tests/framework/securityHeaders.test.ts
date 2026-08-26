import { describe, expect, it } from "vitest"
import {
  CSP_DIRECTIVES,
  buildContentSecurityPolicy,
  buildSecurityHeaders,
} from "@/Framework/Security/securityHeaders"

function headerMap(headers: { key: string; value: string }[]): Record<string, string> {
  return Object.fromEntries(headers.map((h) => [h.key, h.value]))
}

describe("baseline security headers", () => {
  const headers = headerMap(buildSecurityHeaders({ isProduction: true, mode: "report-only" }))

  it("stops MIME sniffing", () => {
    // The File Manager serves user-uploaded bytes; a browser that sniffs an
    // uploaded file into text/html turns storage into stored XSS.
    expect(headers["X-Content-Type-Options"]).toBe("nosniff")
  })

  it("blocks framing two ways, for old and current browsers", () => {
    expect(headers["X-Frame-Options"]).toBe("DENY")
    // frame-ancestors is the modern equivalent and the only one that can
    // express a policy at all in browsers that dropped X-Frame-Options.
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'")
  })

  it("does not leak the full admin URL to third parties", () => {
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin")
  })

  it("switches off device APIs this app never uses", () => {
    const policy = headers["Permissions-Policy"]
    for (const feature of ["camera", "microphone", "geolocation"]) {
      expect(policy, feature).toContain(`${feature}=()`)
    }
  })

  it("sends HSTS in production", () => {
    expect(headers["Strict-Transport-Security"]).toContain("max-age=")
  })
})

describe("HSTS is production-only", () => {
  it("is absent in development", () => {
    // A dev machine on plain http that gets pinned to https by its own app is
    // a genuinely painful, and entirely self-inflicted, outage.
    const dev = headerMap(buildSecurityHeaders({ isProduction: false, mode: "report-only" }))
    expect(dev["Strict-Transport-Security"]).toBeUndefined()
  })
})

describe("CSP enforcement mode", () => {
  it("reports rather than enforces by default", () => {
    const headers = headerMap(buildSecurityHeaders({ isProduction: true, mode: "report-only" }))
    // The full policy goes out as report-only...
    expect(headers["Content-Security-Policy-Report-Only"]).toContain("default-src")
    // ...but clickjacking protection is enforced regardless, because
    // frame-ancestors cannot break a page that was not being framed.
    expect(headers["Content-Security-Policy"]).toBe("frame-ancestors 'none'")
  })

  it("enforces the full policy when asked", () => {
    const headers = headerMap(buildSecurityHeaders({ isProduction: true, mode: "enforce" }))
    expect(headers["Content-Security-Policy"]).toContain("default-src")
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'")
    expect(headers["Content-Security-Policy-Report-Only"]).toBeUndefined()
  })

  it("can be switched off entirely for an operator with their own policy", () => {
    const headers = headerMap(buildSecurityHeaders({ isProduction: true, mode: "off" }))
    expect(headers["Content-Security-Policy-Report-Only"]).toBeUndefined()
    // Clickjacking protection survives even here, via X-Frame-Options.
    expect(headers["X-Frame-Options"]).toBe("DENY")
  })
})

describe("the policy itself", () => {
  const policy = buildContentSecurityPolicy()

  it("permits what Next.js actually needs to hydrate", () => {
    // Next's App Router inlines bootstrap scripts and the RSC payload. Static
    // headers cannot carry a per-request nonce, so inline scripts must be
    // permitted or every page breaks. This is stated plainly rather than
    // hidden: it is the main reason the full policy ships report-only until an
    // operator opts in.
    expect(CSP_DIRECTIVES["script-src"]).toContain("'unsafe-inline'")
  })

  it("permits the inline styles TinyMCE and the editor rely on", () => {
    expect(CSP_DIRECTIVES["style-src"]).toContain("'unsafe-inline'")
  })

  it("allows images from any https origin, because the S3 endpoint is runtime config", () => {
    // Presigned URLs point at whatever bucket the operator configured, and that
    // is not known when these headers are built.
    expect(CSP_DIRECTIVES["img-src"]).toContain("https:")
    expect(CSP_DIRECTIVES["img-src"]).toContain("data:")
    expect(CSP_DIRECTIVES["img-src"]).toContain("blob:")
  })

  it("forbids plugins and base-tag hijacking outright", () => {
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("base-uri 'self'")
    expect(policy).toContain("form-action 'self'")
  })

  it("serialises to a valid directive list", () => {
    expect(policy).toMatch(/^[a-z-]+ [^;]+(; [a-z-]+ [^;]+)*$/)
    expect(policy).not.toContain(";;")
    expect(policy.endsWith(";")).toBe(false)
  })

  it("has a default-src so an unlisted resource type is not unrestricted", () => {
    expect(policy).toContain("default-src 'self'")
  })
})
