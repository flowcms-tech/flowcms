import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { canManageMenus, canManageAppearance, ROLES, type Role } from "@/Framework/Auth/permissions"
import { ROUTE_POLICIES, resolveRouteAccess } from "@/Framework/Auth/routePolicies"
import {
  ACTIVITY_ENTITY_TYPES,
  ACTIVITY_ENTITY_LABELS,
  activityEntityHref,
} from "@/Framework/Activity/activityTypes"
import { MENU_FIELD_LABELS, MENU_ITEM_FIELD_LABELS } from "@/Framework/Activity/fieldLabels"

/**
 * Who may manage menus, and where that is enforced.
 *
 * Menus are EDITORIAL, not administrative — a menu is a set of links to
 * content, and the people who write the content are the people who decide how
 * it is reached. That is a genuinely different threshold from
 * `canManageAppearance`: switching a theme changes every page's markup at once,
 * while adding a menu item changes a list of links. This test pins the
 * difference so that "appearance" is never collapsed into one permission out of
 * tidiness.
 */

describe("canManageMenus", () => {
  it("allows editor and above, and refuses contributor", () => {
    const expected: Record<Role, boolean> = {
      owner: true,
      admin: true,
      editor: true,
      contributor: false,
    }
    for (const role of ROLES) expect(canManageMenus(role), role).toBe(expected[role])
  })

  it("is deliberately LOWER than the theme-activation threshold", () => {
    // If these ever become the same predicate, one of the two decisions has
    // been made by accident.
    expect(canManageMenus("editor")).toBe(true)
    expect(canManageAppearance("editor")).toBe(false)
  })

  it("covers every role, so a new one cannot default to allowed", () => {
    for (const role of ROLES) expect(typeof canManageMenus(role)).toBe("boolean")
  })
})

describe("route policy", () => {
  const paths = [
    "appearance/menus",
    "appearance/menus/[id]",
    "appearance/menus/[id]/items",
    "appearance/menus/[id]/items/[itemId]",
  ]

  it.each(paths)("declares a policy for %s", (path) => {
    expect(ROUTE_POLICIES[path], path).toBeDefined()
  })

  it.each(paths)("gates %s at editor, reads included", (path) => {
    // GET is gated too: the listing names unpublished pages and trashed posts
    // by way of broken-reference warnings, which is editorial information.
    for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE"] as const) {
      expect(resolveRouteAccess(`/api/${path}`, method)?.access, `${method} ${path}`).toBe("editor")
    }
  })

  it.each(paths)("is not public: %s", (path) => {
    expect(ROUTE_POLICIES[path].default).not.toBe("public")
  })

  it.each(paths)("records a real reason for %s", (path) => {
    expect(ROUTE_POLICIES[path].reason.length).toBeGreaterThan(40)
  })
})

describe("every menu route enforces the role itself, not only the policy floor", () => {
  const routes = [
    "src/app/api/appearance/menus/route.ts",
    "src/app/api/appearance/menus/[id]/route.ts",
    "src/app/api/appearance/menus/[id]/items/route.ts",
    "src/app/api/appearance/menus/[id]/items/[itemId]/route.ts",
  ]

  it.each(routes)("%s calls requireApiAuth and canManageMenus in every verb", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8")
    const verbs = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)]
    expect(verbs.length, "route exports at least one verb").toBeGreaterThan(0)

    // One gate call and one role check per exported verb. Counting rather than
    // spot-checking is what catches a verb added later without either.
    expect((source.match(/requireApiAuth\(/g) ?? []).length).toBe(verbs.length)
    expect((source.match(/canManageMenus\(/g) ?? []).length).toBe(verbs.length)
  })

  it.each(routes)("%s leaks no database error to the caller", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8")
    // A caught error must never be serialised into the response body.
    expect(source).not.toMatch(/message:\s*(?:String\()?\w*(?:error|err|e)\.message/i)
    expect(source).not.toMatch(/\.stack/)
  })
})

describe("activity vocabulary", () => {
  it("has entity types for a menu and a menu item", () => {
    expect(ACTIVITY_ENTITY_TYPES).toContain("menu")
    expect(ACTIVITY_ENTITY_TYPES).toContain("menu_item")
    expect(ACTIVITY_ENTITY_LABELS.menu).toBeTruthy()
    expect(ACTIVITY_ENTITY_LABELS.menu_item).toBeTruthy()
  })

  it("links both to the Menus screen, admin-relative", () => {
    // Admin-relative: the caller joins the configured public admin path, so
    // this keeps working under FLOWCMS_ADMIN_PATH.
    expect(activityEntityHref("menu", "abc")).toBe("/appearance/menus")
    expect(activityEntityHref("menu_item", "abc")).toBe("/appearance/menus")
    expect(activityEntityHref("menu", "abc")?.startsWith("/admin")).toBe(false)
  })

  it("names the fields a menu summary may mention, and no others", () => {
    expect(Object.keys(MENU_FIELD_LABELS).sort()).toEqual(["location", "name"])
    // `updatedAt` must never be namable, here as everywhere else.
    expect(MENU_FIELD_LABELS.updatedAt).toBeUndefined()
    expect(MENU_ITEM_FIELD_LABELS.updatedAt).toBeUndefined()
  })

  it("names the menu-item fields an operator would recognise", () => {
    for (const field of ["label", "target", "type", "isActive", "opensInNewTab", "parentId"]) {
      expect(MENU_ITEM_FIELD_LABELS[field], field).toBeTruthy()
    }
  })
})
