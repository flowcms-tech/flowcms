import { describe, expect, it } from "vitest"
import {
  ROUTE_POLICIES,
  isAuthorizedForAccess,
  resolveRouteAccess,
} from "@/Framework/Auth/routePolicies"

describe("resolveRouteAccess — pattern matching", () => {
  it("matches a static route", () => {
    expect(resolveRouteAccess("/api/dashboard", "GET")?.pattern).toBe("dashboard")
  })

  it("matches a dynamic segment", () => {
    expect(resolveRouteAccess("/api/blog/posts/abc-123", "GET")?.pattern).toBe("blog/posts/[id]")
  })

  it("prefers a static segment over a dynamic one at the same depth", () => {
    // Next.js resolves /api/blog/posts/bulk to the static file, not [id].
    // The policy lookup has to agree, or `bulk` would inherit [id]'s floor.
    expect(resolveRouteAccess("/api/blog/posts/bulk", "PATCH")?.pattern).toBe("blog/posts/bulk")
    expect(resolveRouteAccess("/api/blog/posts/link-suggestions", "GET")?.pattern).toBe(
      "blog/posts/link-suggestions"
    )
  })

  it("prefers a deeper static match over a shallower dynamic one", () => {
    expect(resolveRouteAccess("/api/blog/posts/abc/faq/reorder", "POST")?.pattern).toBe(
      "blog/posts/[id]/faq/reorder"
    )
    expect(resolveRouteAccess("/api/blog/posts/abc/faq/xyz", "PATCH")?.pattern).toBe(
      "blog/posts/[id]/faq/[faqId]"
    )
  })

  it("matches a catch-all across multiple segments", () => {
    const match = resolveRouteAccess("/api/public/images/posts/2026/cover.jpg", "GET")
    expect(match?.pattern).toBe("public/images/[...key]")
    expect(match?.access).toBe("public")
  })

  it("tolerates a trailing slash and a query-free absolute path", () => {
    expect(resolveRouteAccess("/api/dashboard/", "GET")?.pattern).toBe("dashboard")
  })

  it("returns null for an unregistered path so the caller fails closed", () => {
    expect(resolveRouteAccess("/api/does-not-exist", "GET")).toBeNull()
    expect(resolveRouteAccess("/api/blog/posts/abc/not-a-subroute", "GET")).toBeNull()
  })

  it("applies a per-method override and falls back to the default otherwise", () => {
    // Reading taxonomy is something a contributor must do to fill in the post
    // form; creating one is an editorial act.
    expect(resolveRouteAccess("/api/blog/categories", "GET")?.access).toBe("contributor")
    expect(resolveRouteAccess("/api/blog/categories", "POST")?.access).toBe("editor")
  })

  it("treats an unlisted method as the route default rather than allowing it", () => {
    const access = resolveRouteAccess("/api/blog/categories", "TRACE")?.access
    expect(access).toBe("editor")
  })
})

describe("isAuthorizedForAccess", () => {
  it("lets any role through a public route, including no role at all", () => {
    expect(isAuthorizedForAccess("public", null)).toBe(true)
    expect(isAuthorizedForAccess("public", "contributor")).toBe(true)
  })

  it("rejects an unauthenticated caller on every non-public route", () => {
    expect(isAuthorizedForAccess("contributor", null)).toBe(false)
    expect(isAuthorizedForAccess("owner", null)).toBe(false)
  })

  it("admits a role at or above the floor and rejects anything below", () => {
    expect(isAuthorizedForAccess("editor", "editor")).toBe(true)
    expect(isAuthorizedForAccess("editor", "admin")).toBe(true)
    expect(isAuthorizedForAccess("editor", "owner")).toBe(true)
    expect(isAuthorizedForAccess("editor", "contributor")).toBe(false)
    expect(isAuthorizedForAccess("admin", "editor")).toBe(false)
  })
})

describe("ROUTE_POLICIES — registry hygiene", () => {
  it("gives every policy a written reason", () => {
    const missing = Object.entries(ROUTE_POLICIES)
      .filter(([, policy]) => !policy.reason || policy.reason.trim().length < 10)
      .map(([pattern]) => pattern)
    expect(missing).toEqual([])
  })

  it("keeps the public allowlist small and explicit", () => {
    const publicPatterns = Object.entries(ROUTE_POLICIES)
      .filter(
        ([, p]) =>
          p.default === "public" ||
          Object.values(p.methods ?? {}).some((a) => a === "public")
      )
      .map(([pattern]) => pattern)
      .sort()

    // Any addition to this list is a deliberate decision to expose an endpoint
    // to the internet and should be reviewed as one.
    expect(publicPatterns).toEqual([
      "auth/[...nextauth]",
      "captcha",
      // Container probes. Unauthenticated by necessity — an orchestrator has no
      // session — and safe because they return states, never values. The
      // payload contract is enforced separately in
      // tests/framework/readiness.test.ts.
      "health",
      "public/404-log",
      "public/images/[...key]",
      "public/indexnow-key.txt",
      "public/questions",
      "ready",
      // First-run setup. Unauthenticated by necessity — it creates the first
      // account — and the ONLY public mutation that does. Its policy entry
      // names the five controls that replace the session, and
      // tests/setup/setupRoute.test.ts proves each of them.
      "setup",
    ])
  })
})
