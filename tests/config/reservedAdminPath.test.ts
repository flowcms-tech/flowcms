import { describe, expect, it } from "vitest"
import { isReservedPath } from "@/Framework/Functions/reservedPaths"
import { coreRobotsDisallow } from "@/Modules/Settings/Values/robotsRules"

/**
 * Precedence between the admin namespace and custom CMS pages.
 *
 * The installer cannot know what pages an editor will create later, and an
 * editor cannot know what path the installer chose. Something has to win, and
 * it is the admin namespace: the alternative is a content row that shadows the
 * control panel, locking an operator out of the only place they could fix it.
 * A page refused at save time is a message; a page that swallows the admin
 * panel is a support ticket.
 */
describe("the configured admin namespace is reserved against custom pages", () => {
  it("reserves the admin root and everything under it", () => {
    expect(isReservedPath("/control-center", "/control-center")).toBe(true)
    expect(isReservedPath("/control-center/anything", "/control-center")).toBe(true)
    expect(isReservedPath("/control-center/deep/nested", "/control-center")).toBe(true)
  })

  it("does not reserve a prefix collision", () => {
    // "/control-center-news" is a perfectly good article URL and must stay
    // available: it is not inside the admin namespace, only adjacent to it.
    expect(isReservedPath("/control-center-news", "/control-center")).toBe(false)
    expect(isReservedPath("/control-centerX", "/control-center")).toBe(false)
  })

  it("reserves a nested admin root correctly", () => {
    expect(isReservedPath("/internal/admin", "/internal/admin")).toBe(true)
    expect(isReservedPath("/internal/admin/blog", "/internal/admin")).toBe(true)
    // The parent segment is NOT reserved — only the configured root is.
    expect(isReservedPath("/internal", "/internal/admin")).toBe(false)
    expect(isReservedPath("/internal/other", "/internal/admin")).toBe(false)
  })

  it("still reserves the built-in routes", () => {
    for (const path of [
      "/api",
      "/blog",
      "/admin-panel",
      "/preview",
      "/sitemap",
      "/robots.txt",
      "/sitemap.xml",
      "/favicon.ico",
    ]) {
      expect(isReservedPath(path, "/control-center"), path).toBe(true)
    }
  })

  it("still works when no admin root is supplied", () => {
    expect(isReservedPath("/api")).toBe(true)
    expect(isReservedPath("/about")).toBe(false)
  })

  it("leaves ordinary custom pages alone", () => {
    for (const path of ["/about", "/contact", "/pricing", "/about/team"]) {
      expect(isReservedPath(path, "/control-center"), path).toBe(false)
    }
  })
})

describe("robots.txt disallow rules", () => {
  it("disallows the configured public admin path, not the internal route", () => {
    const rules = coreRobotsDisallow("/control-center")

    expect(rules).toContain("/control-center")
    // Emitting the internal route would publish an implementation detail to
    // every crawler while failing to hide the panel anyone can actually reach.
    expect(rules).not.toContain("/admin-panel")
  })

  it("tracks whatever path is configured", () => {
    expect(coreRobotsDisallow("/secure-console")).toContain("/secure-console")
    expect(coreRobotsDisallow("/admin")).toContain("/admin")
  })

  it("still disallows the API", () => {
    expect(coreRobotsDisallow("/control-center")).toContain("/api/")
  })
})
