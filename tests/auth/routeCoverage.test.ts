import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { ROUTE_POLICIES, resolveRouteAccess } from "@/Framework/Auth/routePolicies"

/**
 * The structural half of the access-control fix.
 *
 * A checklist rots. This walks `src/app/api` on disk and fails the build when a
 * route handler exists without a policy entry, so a new endpoint cannot ship
 * unauthorized by omission — the failure arrives at `bun run test`, before
 * review, not after a pentest.
 *
 * It also fails on the reverse: a policy naming a route that no longer exists.
 * A stale entry is how a registry starts lying about what it covers.
 */

const API_ROOT = fileURLToPath(new URL("../../src/app/api", import.meta.url))

function findRouteFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      found.push(...findRouteFiles(full))
    } else if (entry === "route.ts" || entry === "route.tsx") {
      found.push(full)
    }
  }
  return found
}

/** `src/app/api/blog/posts/[id]/route.ts` -> `blog/posts/[id]` */
function toPattern(file: string): string {
  return relative(API_ROOT, file).split(sep).slice(0, -1).join("/")
}

const routeFiles = findRouteFiles(API_ROOT)
const routePatterns = routeFiles.map(toPattern).sort()

describe("route policy coverage", () => {
  it("finds the API tree (guards against the walker silently matching nothing)", () => {
    expect(routePatterns.length).toBeGreaterThan(50)
  })

  it("has a policy for every route handler on disk", () => {
    const missing = routePatterns.filter((pattern) => !(pattern in ROUTE_POLICIES))
    expect(
      missing,
      `These route handlers have no entry in ROUTE_POLICIES. Add one — a route ` +
        `without a declared policy is denied at runtime, so it will 403 for ` +
        `everyone until you do:\n  ${missing.join("\n  ")}`
    ).toEqual([])
  })

  it("has no policy for a route that no longer exists", () => {
    const stale = Object.keys(ROUTE_POLICIES)
      .filter((pattern) => !routePatterns.includes(pattern))
      .sort()
    expect(
      stale,
      `These ROUTE_POLICIES entries name routes that are not on disk. Remove ` +
        `them:\n  ${stale.join("\n  ")}`
    ).toEqual([])
  })

  it("resolves every exported method of every route to a concrete floor", () => {
    const unresolved: string[] = []

    for (const file of routeFiles) {
      const source = readFileSync(file, "utf8")
      const methods = [...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map(
        (m) => m[1]
      )
      const pattern = toPattern(file)
      // Substitute a concrete value for each dynamic segment so the resolver is
      // exercised the way a real request exercises it.
      const concretePath =
        "/api/" +
        pattern
          .split("/")
          .map((s) => (s.startsWith("[...") ? "a/b" : s.startsWith("[") ? "sample-id" : s))
          .join("/")

      for (const method of methods) {
        const resolved = resolveRouteAccess(concretePath, method)
        if (!resolved) {
          unresolved.push(`${pattern} ${method} (no match for ${concretePath})`)
        } else if (resolved.pattern !== pattern) {
          unresolved.push(
            `${pattern} ${method} resolved to the wrong policy: ${resolved.pattern}`
          )
        }
      }
    }

    expect(unresolved).toEqual([])
  })

  /**
   * Two routes enforce the floor inline instead of calling the shared gate,
   * because they are browser navigations: they must answer an unauthorized
   * caller with a redirect to a page, not a JSON 403 body nobody can act on.
   * Both check `canManageSettings` directly, which is the same "admin" floor
   * their ROUTE_POLICIES entries declare.
   *
   * Anything added here needs a reason of that quality. The list is asserted
   * exactly, so growing it is a reviewable event.
   */
  const INLINE_ENFORCEMENT_EXEMPTIONS = [
    "integrations/google-search-console/auth",
    "integrations/google-search-console/callback",
  ]

  it("routes every non-public handler through requireApiAuth", () => {
    const publicPatterns = new Set(
      Object.entries(ROUTE_POLICIES)
        .filter(([, p]) => p.default === "public")
        .map(([pattern]) => pattern)
    )

    const ungated = routeFiles
      .map((file) => ({ pattern: toPattern(file), source: readFileSync(file, "utf8") }))
      .filter(({ pattern }) => !publicPatterns.has(pattern))
      .filter(({ pattern }) => !INLINE_ENFORCEMENT_EXEMPTIONS.includes(pattern))
      .filter(({ source }) => !source.includes("requireApiAuth"))
      .map(({ pattern }) => pattern)
      .sort()

    expect(
      ungated,
      `These non-public routes never call requireApiAuth, so they are ` +
        `authenticated at best and unauthorized at worst:\n  ${ungated.join("\n  ")}`
    ).toEqual([])
  })

  it("keeps the inline-enforcement exemptions to routes that still check a role", () => {
    for (const pattern of INLINE_ENFORCEMENT_EXEMPTIONS) {
      const file = routeFiles.find((f) => toPattern(f) === pattern)
      expect(file, `exemption names a route that does not exist: ${pattern}`).toBeDefined()
      const source = readFileSync(file!, "utf8")
      expect(source, `${pattern} is exempt from the gate but checks no role`).toMatch(
        /canManageSettings\(/
      )
    }
  })

  it("leaves no handler still using the bare authenticate-only idiom", () => {
    const stragglers = routeFiles
      .filter((file) => {
        const source = readFileSync(file, "utf8")
        return /const session = await auth\(\)[\s\S]{0,120}message: "Unauthorized"/.test(source)
      })
      .map(toPattern)
      .filter((pattern) => !INLINE_ENFORCEMENT_EXEMPTIONS.includes(pattern))
      .sort()

    expect(
      stragglers,
      `These routes still authenticate without authorizing:\n  ${stragglers.join("\n  ")}`
    ).toEqual([])
  })

  it("never leaves a route handler on the default-deny path by accident", () => {
    // Every pattern must resolve to a real access value for at least GET —
    // a typo in a registry key would otherwise show up only as a 403 in prod.
    const broken = Object.keys(ROUTE_POLICIES).filter((pattern) => {
      const concrete =
        "/api/" +
        pattern
          .split("/")
          .map((s) => (s.startsWith("[...") ? "a/b" : s.startsWith("[") ? "sample-id" : s))
          .join("/")
      return resolveRouteAccess(concrete, "GET")?.pattern !== pattern
    })
    expect(broken).toEqual([])
  })
})
