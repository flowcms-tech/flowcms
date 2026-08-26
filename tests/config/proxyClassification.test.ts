import { describe, expect, it } from "vitest"
import {
  classifyRequestPath,
  toInternalAdminPath,
} from "@/Framework/Config/adminPathCore"

/**
 * The proxy's decision table.
 *
 * The proxy module itself cannot be imported here — it constructs a NextAuth
 * instance at module load, which needs a request context that does not exist in
 * a unit test. What is worth pinning down is the decision it makes, which is
 * pure. The wiring around that decision is verified against a running server
 * instead, because that is the only place a rewrite can actually be observed.
 */
describe("proxy decision table", () => {
  const ADMIN = "/control-center"

  const cases: Array<[string, "admin" | "internal" | "public", string | null]> = [
    ["/control-center", "admin", "/admin-panel"],
    ["/control-center/login", "admin", "/admin-panel/login"],
    ["/control-center/blog/posts", "admin", "/admin-panel/blog/posts"],
    ["/control-center/blog/posts/7/edit", "admin", "/admin-panel/blog/posts/7/edit"],
    ["/admin-panel", "internal", null],
    ["/admin-panel/login", "internal", null],
    ["/admin-panel/blog/posts", "internal", null],
    ["/", "public", null],
    ["/blog", "public", null],
    ["/blog/some-post", "public", null],
    ["/about", "public", null],
    ["/robots.txt", "public", null],
    ["/sitemap-index.xml", "public", null],
  ]

  for (const [pathname, expectedClass, expectedRewrite] of cases) {
    it(`${pathname} → ${expectedClass}`, () => {
      expect(classifyRequestPath(pathname, ADMIN)).toBe(expectedClass)
      if (expectedRewrite !== null) {
        expect(toInternalAdminPath(pathname, ADMIN)).toBe(expectedRewrite)
      }
    })
  }

  it("never classifies the internal route as admin, whatever the config", () => {
    for (const configured of ["/admin", "/control-center", "/internal/admin"]) {
      expect(classifyRequestPath("/admin-panel/login", configured)).toBe("internal")
    }
  })

  it("rewrites only within the admin namespace", () => {
    // A public path must never produce a rewrite target under /admin-panel;
    // this is the property that keeps the CMS catch-all working.
    expect(classifyRequestPath("/about", ADMIN)).toBe("public")
    expect(classifyRequestPath("/control-center-news", ADMIN)).toBe("public")
  })
})
