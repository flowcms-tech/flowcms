import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { canManageAppearance, canManageSettings, ROLES, type Role } from "@/Framework/Auth/permissions"
import { resolveRouteAccess } from "@/Framework/Auth/routePolicies"

/**
 * Who may look at Appearance, and who may change it.
 *
 * Theme activation is the only setting in FlowCMS that changes every page of
 * the public site at once, with no confirmation step and no staging. It sits at
 * `admin`, alongside settings and staff accounts — an editor's authority is
 * over content, not over how the site looks to every visitor.
 */

describe("canManageAppearance", () => {
  const expected: Record<Role, boolean> = {
    owner: true,
    admin: true,
    editor: false,
    contributor: false,
  }

  it.each(ROLES)("%s", (role) => {
    expect(canManageAppearance(role)).toBe(expected[role])
  })

  it("matches the settings threshold exactly", () => {
    // Both change how the public site behaves and both take effect at once. If
    // one moves, the other should be a deliberate decision rather than drift.
    for (const role of ROLES) {
      expect(canManageAppearance(role)).toBe(canManageSettings(role))
    }
  })

  it("covers every role, so a new one cannot default to allowed", () => {
    expect(Object.keys(expected).sort()).toEqual([...ROLES].sort())
  })
})

describe("route policy", () => {
  it("gates both verbs at admin", () => {
    // GET as well as POST: the listing is the operator's appearance
    // configuration, including which themes stopped working after an upgrade.
    expect(resolveRouteAccess("/api/appearance/themes", "GET")?.access).toBe("admin")
    expect(resolveRouteAccess("/api/appearance/themes", "POST")?.access).toBe("admin")
  })

  it("is not public", () => {
    expect(resolveRouteAccess("/api/appearance/themes", "GET")?.access).not.toBe("public")
  })
})

describe("the handler enforces the role itself, not only the policy floor", () => {
  /**
   * The route policy is a floor. It stops an unauthenticated caller and anyone
   * below admin, which is already the whole requirement here — but the floor is
   * one table away from the handler, and a policy edit could widen it without
   * anyone reading this route again. Both verbs check the capability directly,
   * the same way `settings/global` does.
   */
  const source = readFileSync(
    join(process.cwd(), "src", "app", "api", "appearance", "themes", "route.ts"),
    "utf8",
  )

  it("calls requireApiAuth in both verbs", () => {
    expect(source.match(/requireApiAuth\(request\)/g) ?? []).toHaveLength(2)
  })

  it("calls canManageAppearance in both verbs", () => {
    expect(source.match(/canManageAppearance\(/g) ?? []).toHaveLength(2)
  })

  it("does not re-implement the domain validation the service owns", () => {
    // Two sets of rules for what a valid theme is would drift, and the domain
    // function is the one proved against four database engines.
    expect(source).not.toMatch(/getInstalledTheme|isWellFormedThemeSlug|flowcmsCompat/)
    expect(source).toContain("setActiveTheme")
  })

  it("returns no registry internals", () => {
    expect(source).not.toMatch(/listInstalledThemes|\.problems|manifest\./)
  })
})
