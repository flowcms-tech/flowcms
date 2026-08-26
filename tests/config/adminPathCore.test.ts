import { describe, expect, it } from "vitest"
import {
  DEFAULT_ADMIN_PATH,
  INTERNAL_ADMIN_PATH,
  classifyRequestPath,
  joinAdminPath,
  resolveAdminPathFrom,
  toInternalAdminPath,
  validateAdminPath,
} from "@/Framework/Config/adminPathCore"

/**
 * The rules governing where the admin panel is reachable.
 *
 * These are worth testing thoroughly out of proportion to their size. The
 * function decides, from a string an operator typed into an environment file,
 * which URL namespace serves an authenticated control panel. A bug here does
 * not produce a wrong answer on a screen — it produces an admin panel somewhere
 * nobody expected, or no admin panel at all.
 */

describe("validateAdminPath", () => {
  it("accepts ordinary single-segment paths", () => {
    for (const input of ["/admin", "/control-center", "/secure-console", "/ops-82x"]) {
      expect(validateAdminPath(input), input).toMatchObject({ ok: true, value: input })
    }
  })

  it("supports nested paths", () => {
    expect(validateAdminPath("/internal/admin")).toMatchObject({
      ok: true,
      value: "/internal/admin",
    })
  })

  it("normalizes recoverable input", () => {
    const cases: Array<[string, string]> = [
      ["admin", "/admin"],
      ["/admin/", "/admin"],
      ["  /admin  ", "/admin"],
      ["//admin", "/admin"],
      ["/admin//sub", "/admin/sub"],
    ]
    for (const [input, expected] of cases) {
      expect(validateAdminPath(input), input).toMatchObject({ ok: true, value: expected })
    }
  })

  it("rejects reserved routes", () => {
    for (const input of [
      "/api",
      "/_next",
      "/blog",
      "/preview",
      "/sitemap",
      "/admin-panel",
      "/robots.txt",
      "/favicon.ico",
      "/sitemap.xml",
      "/sitemap-index.xml",
    ]) {
      expect(validateAdminPath(input), input).toMatchObject({ ok: false })
    }
  })

  it("rejects a reserved first segment even when nested", () => {
    expect(validateAdminPath("/api/admin")).toMatchObject({ ok: false })
    expect(validateAdminPath("/blog/admin")).toMatchObject({ ok: false })
  })

  it("rejects the root and empty values", () => {
    for (const input of ["", "   ", "/", "//"]) {
      expect(validateAdminPath(input), JSON.stringify(input)).toMatchObject({ ok: false })
    }
  })

  it("rejects traversal, literal and percent-encoded", () => {
    for (const input of [
      "/admin/..",
      "/admin/../etc",
      "/..",
      "/.",
      "/admin/%2e%2e",
      "/admin%2f..",
      "/%2e%2e/admin",
    ]) {
      expect(validateAdminPath(input), input).toMatchObject({ ok: false })
    }
  })

  it("rejects query strings and fragments", () => {
    for (const input of ["/admin?x=1", "/admin#top", "/admin?", "/admin#"]) {
      expect(validateAdminPath(input), input).toMatchObject({ ok: false })
    }
  })

  it("rejects backslashes and internal whitespace", () => {
    // Surrounding whitespace is trimmed rather than rejected — "  /admin  " is
    // a copy-paste artefact, not an ambiguous intent. Whitespace *inside* the
    // path is a different thing: there is no reading of "/ad min" that is
    // obviously what the operator meant.
    for (const input of ["/admin\\panel", "/ad min", "/admin\tpanel", "/admin\npanel"]) {
      expect(validateAdminPath(input), JSON.stringify(input)).toMatchObject({ ok: false })
    }
  })

  it("rejects control characters", () => {
    // Written as escapes deliberately: a literal NUL or DEL byte in a source
    // file is invisible in review and turns the file binary to every tool.
    for (const input of ["/admin\u0000", "/admin\u0007panel", "/admin\u007f"]) {
      expect(validateAdminPath(input), JSON.stringify(input)).toMatchObject({ ok: false })
    }
  })

  it("rejects non-string input", () => {
    for (const input of [undefined, null, 42, {}, []]) {
      expect(validateAdminPath(input), String(input)).toMatchObject({ ok: false })
    }
  })

  it("names the offending value and a reason when rejecting", () => {
    const result = validateAdminPath("/api")
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected rejection")
    expect(result.reason).toMatch(/reserved/i)
  })
})

describe("resolveAdminPathFrom", () => {
  it("defaults when the variable is unset or blank", () => {
    for (const raw of [undefined, "", "   "]) {
      expect(resolveAdminPathFrom(raw)).toBe(DEFAULT_ADMIN_PATH)
    }
  })

  it("returns the normalized configured value", () => {
    expect(resolveAdminPathFrom("/secure-console")).toBe("/secure-console")
    expect(resolveAdminPathFrom("control-center/")).toBe("/control-center")
  })

  it("throws a message naming the variable, the value and the reason", () => {
    expect(() => resolveAdminPathFrom("/api")).toThrowError(/FLOWCMS_ADMIN_PATH/)
    expect(() => resolveAdminPathFrom("/api")).toThrowError(/\/api/)
    expect(() => resolveAdminPathFrom("/api")).toThrowError(/reserved/i)
  })

  it("never silently falls back to the internal path", () => {
    for (const raw of [undefined, "", "/secure-console"]) {
      expect(resolveAdminPathFrom(raw)).not.toBe(INTERNAL_ADMIN_PATH)
    }
    expect(() => resolveAdminPathFrom(INTERNAL_ADMIN_PATH)).toThrow()
  })
})

describe("joinAdminPath", () => {
  it("returns the root when there is no sub-path", () => {
    expect(joinAdminPath("/admin")).toBe("/admin")
    expect(joinAdminPath("/admin", "")).toBe("/admin")
    expect(joinAdminPath("/admin", "/")).toBe("/admin")
  })

  it("joins without duplicating slashes", () => {
    expect(joinAdminPath("/secure-console", "/login")).toBe("/secure-console/login")
    expect(joinAdminPath("/secure-console", "login")).toBe("/secure-console/login")
    expect(joinAdminPath("/secure-console", "//login")).toBe("/secure-console/login")
    expect(joinAdminPath("/secure-console/", "/login")).toBe("/secure-console/login")
  })

  it("joins nested sub-paths", () => {
    expect(joinAdminPath("/admin", "/blog/posts")).toBe("/admin/blog/posts")
    expect(joinAdminPath("/internal/admin", "/settings")).toBe("/internal/admin/settings")
  })

  it("preserves a query string on the sub-path", () => {
    expect(joinAdminPath("/admin", "/blog/posts?trashed=true")).toBe(
      "/admin/blog/posts?trashed=true",
    )
  })

  it("never emits a doubled slash for any combination", () => {
    for (const root of ["/admin", "/admin/", "/internal/admin"]) {
      for (const sub of [undefined, "", "/", "x", "/x", "//x", "/x/"]) {
        expect(joinAdminPath(root, sub), `${root} + ${sub}`).not.toMatch(/\/\//)
      }
    }
  })
})

describe("classifyRequestPath", () => {
  const PUBLIC = "/secure-console"

  it("classifies the admin namespace", () => {
    for (const pathname of [
      "/secure-console",
      "/secure-console/",
      "/secure-console/login",
      "/secure-console/blog/posts/12/edit",
    ]) {
      expect(classifyRequestPath(pathname, PUBLIC), pathname).toBe("admin")
    }
  })

  it("classifies the internal route", () => {
    for (const pathname of ["/admin-panel", "/admin-panel/", "/admin-panel/login"]) {
      expect(classifyRequestPath(pathname, PUBLIC), pathname).toBe("internal")
    }
  })

  it("classifies everything else as public", () => {
    for (const pathname of [
      "/",
      "/blog",
      "/blog/some-post",
      "/about",
      "/robots.txt",
      "/api/captcha",
    ]) {
      expect(classifyRequestPath(pathname, PUBLIC), pathname).toBe("public")
    }
  })

  it("does not treat a prefix collision as admin", () => {
    // The bug this prevents: startsWith("/secure-console") alone would classify
    // a public page named "/secure-console-decoy" as admin and rewrite it into
    // the panel, which is both a broken public page and a routing surprise.
    for (const pathname of [
      "/secure-console-decoy",
      "/secure-consoleX",
      "/secure-console-decoy/login",
    ]) {
      expect(classifyRequestPath(pathname, PUBLIC), pathname).toBe("public")
    }
  })

  it("does not treat a prefix collision as internal", () => {
    expect(classifyRequestPath("/admin-panel-decoy", PUBLIC)).toBe("public")
  })

  it("works when the admin path is the default", () => {
    expect(classifyRequestPath("/admin/login", "/admin")).toBe("admin")
    expect(classifyRequestPath("/administrator", "/admin")).toBe("public")
  })

  it("works for a nested admin path", () => {
    expect(classifyRequestPath("/internal/admin", "/internal/admin")).toBe("admin")
    expect(classifyRequestPath("/internal/admin/blog", "/internal/admin")).toBe("admin")
    expect(classifyRequestPath("/internal", "/internal/admin")).toBe("public")
    expect(classifyRequestPath("/internal/other", "/internal/admin")).toBe("public")
  })

  it("is case sensitive, matching URL path semantics", () => {
    expect(classifyRequestPath("/Secure-Console/login", PUBLIC)).toBe("public")
  })
})

describe("toInternalAdminPath", () => {
  it("swaps the public prefix for the internal one", () => {
    expect(toInternalAdminPath("/secure-console/login", "/secure-console")).toBe(
      "/admin-panel/login",
    )
    expect(toInternalAdminPath("/secure-console/blog/posts", "/secure-console")).toBe(
      "/admin-panel/blog/posts",
    )
  })

  it("maps the namespace root to the internal root", () => {
    expect(toInternalAdminPath("/secure-console", "/secure-console")).toBe("/admin-panel")
    expect(toInternalAdminPath("/secure-console/", "/secure-console")).toBe("/admin-panel")
  })

  it("handles a nested admin path", () => {
    expect(toInternalAdminPath("/internal/admin/settings", "/internal/admin")).toBe(
      "/admin-panel/settings",
    )
  })

  it("replaces only the leading occurrence", () => {
    expect(toInternalAdminPath("/admin/blog/admin", "/admin")).toBe("/admin-panel/blog/admin")
  })
})
