import { describe, expect, it } from "vitest"
import type { Role } from "@/Framework/Auth/permissions"
import {
  ALL_ROLES,
  ROUTE_POLICIES,
  isAuthorizedForAccess,
  resolveRouteAccess,
  type HttpMethod,
} from "@/Framework/Auth/routePolicies"

/**
 * The authorization matrix: every route, every method, every role.
 *
 * This is the artefact that keeps the access-control fix fixed. The registry
 * says what the floor is; this says what the floor MEANS for each of the four
 * roles, in terms a reviewer can check against the product without reading any
 * implementation.
 */

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"]

/** Substitutes a concrete value for each dynamic segment. */
function concretePath(pattern: string): string {
  return (
    "/api/" +
    pattern
      .split("/")
      .map((s) => (s.startsWith("[...") ? "a/b" : s.startsWith("[") ? "sample-id" : s))
      .join("/")
  )
}

function allows(pattern: string, method: HttpMethod, role: Role | null): boolean {
  const resolved = resolveRouteAccess(concretePath(pattern), method)
  if (!resolved) return false
  return isAuthorizedForAccess(resolved.access, role)
}

const ALL_PATTERNS = Object.keys(ROUTE_POLICIES).sort()

const PUBLIC_PATTERNS = ALL_PATTERNS.filter(
  (p) => ROUTE_POLICIES[p].default === "public"
)

describe("unauthenticated callers", () => {
  it("reach public routes and nothing else", () => {
    const reachable = ALL_PATTERNS.filter((pattern) =>
      METHODS.some((method) => allows(pattern, method, null))
    ).sort()
    expect(reachable).toEqual(PUBLIC_PATTERNS.sort())
  })
})

describe("contributor — the least-privileged role", () => {
  /**
   * A contributor drafts posts and submits them for review. They never publish,
   * never touch site configuration, and never administer anything.
   *
   * This is the exact set of routes they may reach, pinned. Any change to it is
   * a change to what the lowest-privileged account can do to a FlowCMS install,
   * and should be argued for in review rather than noticed later.
   */
  const EXPECTED_CONTRIBUTOR_REACHABLE = [
    "auth/[...nextauth]",
    "authors",
    "authors/[id]",
    "blog/categories",
    "blog/categories/[id]",
    "blog/posts",
    "blog/posts/[id]",
    "blog/posts/[id]/faq",
    "blog/posts/[id]/faq/[faqId]",
    "blog/posts/[id]/faq/reorder",
    "blog/posts/[id]/lock",
    "blog/posts/[id]/preview-link",
    "blog/posts/[id]/related",
    "blog/posts/[id]/review",
    "blog/posts/[id]/revisions",
    "blog/posts/[id]/revisions/[revisionId]",
    "blog/posts/link-suggestions",
    "blog/series",
    "blog/series/[id]",
    "blog/tags",
    "blog/tags/[id]",
    "captcha",
    "dashboard",
    "file-manager",
    // Reads the bytes of a stored object for a signed-in user. Same floor as
    // browsing the File Manager, because this is what renders the thumbnails a
    // contributor picks a featured image from. It replaced presigned URLs,
    // which bypassed this matrix entirely by handing the browser a URL that
    // fetched the object store directly, with no role check anywhere.
    "media/[...key]",
    // Container probes, public by necessity — an orchestrator has no session.
    // They appear here because "reachable by a contributor" includes every
    // public route, not because a contributor is granted anything by them:
    // both return fixed state strings and no data.
    "health",
    "public/404-log",
    "public/images/[...key]",
    "public/indexnow-key.txt",
    "public/questions",
    "ready",
    // First-run setup, public for the same structural reason: it exists to
    // create the first account. It appears here because every public route is
    // reachable by every role, and it is harmless to a contributor for the
    // strongest possible reason — by the time any account exists at all, this
    // route returns 404.
    "setup",
  ]

  it("reaches exactly the authoring surface", () => {
    const reachable = ALL_PATTERNS.filter((pattern) =>
      METHODS.some((method) => allows(pattern, method, "contributor"))
    ).sort()
    expect(reachable).toEqual(EXPECTED_CONTRIBUTOR_REACHABLE.sort())
  })

  it("may read taxonomy but never write it", () => {
    for (const pattern of [
      "blog/categories",
      "blog/tags",
      "blog/series",
      "authors",
    ]) {
      expect(allows(pattern, "GET", "contributor"), `${pattern} GET`).toBe(true)
      expect(allows(pattern, "POST", "contributor"), `${pattern} POST`).toBe(false)
    }
    for (const pattern of [
      "blog/categories/[id]",
      "blog/tags/[id]",
      "blog/series/[id]",
      "authors/[id]",
    ]) {
      expect(allows(pattern, "GET", "contributor"), `${pattern} GET`).toBe(true)
      expect(allows(pattern, "PATCH", "contributor"), `${pattern} PATCH`).toBe(false)
      expect(allows(pattern, "DELETE", "contributor"), `${pattern} DELETE`).toBe(false)
    }
  })

  it("may upload media but never delete or move it", () => {
    expect(allows("file-manager", "GET", "contributor")).toBe(true)
    expect(allows("file-manager", "POST", "contributor")).toBe(true)
    // Reading an object's bytes goes through /api/media, at the same floor.
    expect(allows("media/[...key]", "GET", "contributor")).toBe(true)
    // But an anonymous caller must NOT reach it. Anonymous image reads are
    // /api/public/images only, which authorises a key solely because published
    // content refers to it.
    expect(allows("media/[...key]", "GET", null)).toBe(false)
    for (const pattern of [
      "file-manager/file",
      "file-manager/file/copy",
      "file-manager/file/move",
      "file-manager/directory",
      "file-manager/directory/copy",
      "file-manager/directory/move",
    ]) {
      for (const method of METHODS) {
        expect(allows(pattern, method, "contributor"), `${pattern} ${method}`).toBe(false)
      }
    }
  })

  it("cannot publish a public page", () => {
    for (const method of METHODS) {
      expect(allows("pages", method, "contributor"), `pages ${method}`).toBe(false)
      expect(allows("pages/[id]", method, "contributor"), `pages/[id] ${method}`).toBe(false)
    }
  })

  it("cannot create a redirect to an arbitrary external host", () => {
    // The privilege-escalation chain the audit called out: an open redirect
    // from this site's own domain is a phishing primitive that inherits the
    // site's reputation.
    for (const method of METHODS) {
      expect(allows("redirects", method, "contributor"), `redirects ${method}`).toBe(false)
      expect(allows("redirects/[id]", method, "contributor")).toBe(false)
      expect(allows("redirects/import", method, "contributor")).toBe(false)
    }
  })

  it("cannot reach any administrative surface", () => {
    for (const pattern of [
      "admin-users",
      "admin-users/[id]",
      "settings/global",
      "activity-log",
      "redis/status",
      "redis/keys",
      "redis/key",
      "redis/flush",
    ]) {
      for (const method of METHODS) {
        expect(allows(pattern, method, "contributor"), `${pattern} ${method}`).toBe(false)
      }
    }
  })

  it("cannot reach any integration route at all", () => {
    const integrationPatterns = ALL_PATTERNS.filter((p) => p.startsWith("integrations/"))
    expect(integrationPatterns.length).toBeGreaterThan(20)
    for (const pattern of integrationPatterns) {
      for (const method of METHODS) {
        expect(allows(pattern, method, "contributor"), `${pattern} ${method}`).toBe(false)
      }
    }
  })

  it("cannot make the server fetch an arbitrary URL", () => {
    for (const method of METHODS) {
      expect(allows("blog/link-check", method, "contributor")).toBe(false)
    }
  })
})

describe("editor", () => {
  it("has full blog CRUD including publishing and moderation", () => {
    for (const pattern of [
      "blog/posts",
      "blog/posts/[id]",
      "blog/posts/bulk",
      "blog/posts/[id]/duplicate",
      "blog/questions",
      "blog/questions/[id]",
      "blog/categories",
      "blog/tags",
      "blog/series",
      "pages",
      "pages/[id]",
    ]) {
      expect(allows(pattern, "POST", "editor"), `${pattern} POST`).toBe(true)
    }
  })

  it("reads SEO integration data but cannot configure a connection", () => {
    expect(allows("integrations/google-search-console/site-performance", "GET", "editor")).toBe(true)
    expect(allows("integrations/bing-webmaster/overview", "GET", "editor")).toBe(true)
    expect(allows("integrations/pagespeed/core-web-vitals", "GET", "editor")).toBe(true)

    expect(allows("integrations/google-search-console/auth", "GET", "editor")).toBe(false)
    expect(allows("integrations/google-search-console/check", "POST", "editor")).toBe(false)
    expect(allows("integrations/bing-webmaster/check", "POST", "editor")).toBe(false)
    expect(allows("integrations/bing-webmaster/site-settings/roles", "POST", "editor")).toBe(false)
    expect(allows("integrations/indexnow", "POST", "editor")).toBe(false)
  })

  it("lists sitemaps but cannot submit or delete one", () => {
    expect(allows("integrations/google-search-console/sitemaps", "GET", "editor")).toBe(true)
    expect(allows("integrations/google-search-console/sitemaps", "POST", "editor")).toBe(false)
    expect(allows("integrations/google-search-console/sitemaps", "DELETE", "editor")).toBe(false)
    expect(allows("integrations/bing-webmaster/sitemaps", "GET", "editor")).toBe(true)
    expect(allows("integrations/bing-webmaster/sitemaps", "POST", "editor")).toBe(false)
  })

  it("reads and exports redirects but cannot create one", () => {
    expect(allows("redirects", "GET", "editor")).toBe(true)
    expect(allows("redirects/export", "GET", "editor")).toBe(true)
    expect(allows("redirects", "POST", "editor")).toBe(false)
    expect(allows("redirects/[id]", "PATCH", "editor")).toBe(false)
    expect(allows("redirects/import", "POST", "editor")).toBe(false)
  })

  it("cannot administer accounts, settings, the audit log, or Redis", () => {
    for (const pattern of [
      "admin-users",
      "admin-users/[id]",
      "settings/global",
      "activity-log",
      "redis/status",
      "redis/keys",
      "redis/key",
      "redis/flush",
    ]) {
      for (const method of METHODS) {
        expect(allows(pattern, method, "editor"), `${pattern} ${method}`).toBe(false)
      }
    }
  })

  it("cannot see or drive a storage migration, in either direction", () => {
    // Migration is the most destructive thing the admin panel can start, and
    // the READ side matters as much as the write side: the status response
    // names the destination bucket and endpoint, and the entry report is a
    // complete index of every object key in the store.
    for (const pattern of [
      "settings/storage/migration",
      "settings/storage/migration/destination-test",
      "settings/storage/migration/inventory",
      "settings/storage/migration/advance",
      "settings/storage/migration/entries",
      "settings/storage/migration/cutover",
    ]) {
      for (const role of ["contributor", "editor"] as const) {
        for (const method of METHODS) {
          expect(allows(pattern, method, role), `${pattern} ${method} as ${role}`).toBe(false)
        }
      }
      expect(allows(pattern, "GET", "admin"), `${pattern} GET as admin`).toBe(true)
    }
  })

  it("reads Bing crawl statistics but cannot change the crawl rate", () => {
    expect(allows("integrations/bing-webmaster/crawl", "GET", "editor")).toBe(true)
    expect(allows("integrations/bing-webmaster/crawl", "PATCH", "editor")).toBe(false)
  })
})

describe("admin and owner", () => {
  it("reach every route", () => {
    for (const role of ["admin", "owner"] as const) {
      const unreachable = ALL_PATTERNS.filter(
        (pattern) => !METHODS.some((method) => allows(pattern, method, role))
      )
      expect(unreachable, `${role} cannot reach: ${unreachable.join(", ")}`).toEqual([])
    }
  })

  it("differ only inside handlers, not at the route floor", () => {
    // No route is owner-only. The owner/admin distinction is "an admin cannot
    // touch an owner", which is a row-level rule enforced by canAssignRole /
    // canDemoteOwner inside admin-users — not something a URL can express.
    const ownerOnly = ALL_PATTERNS.filter((pattern) =>
      METHODS.some(
        (method) => allows(pattern, method, "owner") && !allows(pattern, method, "admin")
      )
    )
    expect(ownerOnly).toEqual([])
  })
})

describe("monotonicity", () => {
  it("never grants a lower role access a higher role lacks", () => {
    const order: Role[] = ["contributor", "editor", "admin", "owner"]
    const violations: string[] = []

    for (const pattern of ALL_PATTERNS) {
      for (const method of METHODS) {
        for (let i = 0; i < order.length - 1; i++) {
          const lower = allows(pattern, method, order[i])
          const higher = allows(pattern, method, order[i + 1])
          if (lower && !higher) {
            violations.push(`${pattern} ${method}: ${order[i]} yes, ${order[i + 1]} no`)
          }
        }
      }
    }

    expect(violations).toEqual([])
  })

  it("covers every role in ALL_ROLES", () => {
    expect([...ALL_ROLES].sort()).toEqual(["admin", "contributor", "editor", "owner"])
  })
})
