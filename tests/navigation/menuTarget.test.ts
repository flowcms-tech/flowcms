import { describe, expect, it } from "vitest"
import {
  sanitizeCustomTarget,
  postHref,
  taxonomyHref,
  pageHref,
} from "@/Framework/Navigation/menuTarget"

/**
 * What a menu item is allowed to point at.
 *
 * An ALLOWLIST, not a blocklist, and that is the whole design. A blocklist of
 * `javascript:` and `data:` is a list of the schemes somebody thought of;
 * `vbscript:`, `blob:`, and whatever the next engine ships are not on it. Two
 * shapes are accepted — a site-relative path, or an http/https URL — and
 * everything else is refused without needing to be named.
 *
 * This value ends up in an `href` rendered by a theme. A theme is not expected
 * to re-validate it, so this is the only place it can be made safe.
 */

describe("sanitizeCustomTarget — accepted", () => {
  it("accepts a site-relative path", () => {
    expect(sanitizeCustomTarget("/about")).toBe("/about")
  })

  it("accepts a path with a query and a fragment", () => {
    expect(sanitizeCustomTarget("/search?q=locks#results")).toBe("/search?q=locks#results")
  })

  it("accepts the site root", () => {
    expect(sanitizeCustomTarget("/")).toBe("/")
  })

  it("accepts an absolute https URL", () => {
    expect(sanitizeCustomTarget("https://example.com/docs")).toBe("https://example.com/docs")
  })

  it("accepts an absolute http URL", () => {
    expect(sanitizeCustomTarget("http://example.com")).toBe("http://example.com/")
  })

  it("trims surrounding whitespace rather than rejecting it", () => {
    expect(sanitizeCustomTarget("  /contact  ")).toBe("/contact")
  })
})

describe("sanitizeCustomTarget — refused", () => {
  const TAB = String.fromCharCode(9)
  const NEWLINE = String.fromCharCode(10)
  const SOH = String.fromCharCode(1)
  const NUL = String.fromCharCode(0)

  const refused: Array<[name: string, value: string]> = [
    ["empty", ""],
    ["whitespace only", "   "],
    ["javascript scheme", "javascript:alert(1)"],
    ["javascript scheme, mixed case", "JaVaScRiPt:alert(1)"],
    ["javascript scheme with an embedded tab", `java${TAB}script:alert(1)`],
    ["javascript scheme with an embedded newline", `java${NEWLINE}script:alert(1)`],
    ["javascript scheme behind a leading control character", `${SOH}javascript:alert(1)`],
    ["data URL", "data:text/html,<script>alert(1)</script>"],
    ["vbscript scheme", "vbscript:msgbox(1)"],
    ["blob URL", "blob:https://example.com/abc"],
    ["file URL", "file:///etc/passwd"],
    ["protocol-relative URL", "//evil.example.com/path"],
    ["backslash protocol-relative URL", "/\\evil.example.com"],
    ["bare host with no scheme", "example.com/path"],
    ["relative path with no leading slash", "about/us"],
    ["mailto (deliberately out of scope for v0.1)", "mailto:hello@example.com"],
    ["tel (deliberately out of scope for v0.1)", "tel:+15551234"],
    ["a path containing a newline", `/about${NEWLINE}/evil`],
    ["a path containing a null byte", `/about${NUL}/evil`],
  ]

  it.each(refused)("refuses %s", (_name, value) => {
    expect(sanitizeCustomTarget(value)).toBeNull()
  })

  it("refuses a target longer than the column can usefully hold", () => {
    expect(sanitizeCustomTarget(`/${"a".repeat(2100)}`)).toBeNull()
  })
})

describe("entity hrefs", () => {
  it("builds a blog post path", () => {
    expect(postHref("my-first-post")).toBe("/blog/my-first-post")
  })

  it("builds a category archive path", () => {
    expect(taxonomyHref("category", "guides")).toBe("/blog/category/guides")
  })

  it("builds a tag archive path", () => {
    expect(taxonomyHref("tag", "how-to")).toBe("/blog/tag/how-to")
  })

  it("uses a custom page's stored path verbatim, because that IS its URL", () => {
    expect(pageHref("/privacy-policy")).toBe("/privacy-policy")
  })

  it("refuses a page path that is not a rooted path, rather than guessing", () => {
    // A custom page's `path` column is validated on write, so this should be
    // unreachable — but a hand-edited row must not become an off-site link.
    expect(pageHref("https://evil.example.com")).toBeNull()
    expect(pageHref("privacy")).toBeNull()
  })
})
