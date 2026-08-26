import { describe, expect, it } from "vitest"
import { validateAdminPath as cliValidate } from "../../packages/create-flowcms/src/config/adminPath.mjs"
import { validateAdminPath as appValidate } from "@/Framework/Config/adminPathCore"

/**
 * THE INSTALLER AND THE APPLICATION MUST AGREE ABOUT ADMIN PATHS.
 *
 * They cannot share a module. The application's copy is TypeScript inside
 * `src/`, which a published CLI can never reach; exporting it from `flowcms`
 * would widen a public npm API with something no theme author needs; and making
 * the CLI import the application would undo the independence Phase 7.3 exists
 * to establish.
 *
 * So the CLI carries a port, and this file is where the two meet — the same
 * arrangement Phase 7.3 used for secret generation, for the same reason. One
 * rule, two runtimes, proven equal in the one place both are reachable.
 *
 * WHAT DIVERGENCE WOULD COST: an installer that accepts a path the application
 * then refuses at startup. The operator's site does not boot, and the message
 * comes from a component they did not run.
 */

/**
 * One table, both implementations.
 *
 * Written as inputs rather than as expectations so neither side can be
 * "corrected" to match the other — the assertion is that they AGREE, and the
 * separate assertions below pin what they agree on.
 */
const CASES = [
  // Accepted, and normalized identically.
  "/admin",
  "admin",
  "/admin/",
  "  /admin  ",
  "/control",
  "/manage/cms",
  "/a.b~c-d_e",
  "//doubled//separators//",

  // Refused.
  "",
  "   ",
  "/",
  "//",
  "/admin-panel",
  "/admin-panel/login",
  "/api",
  "/blog",
  "/preview",
  "/sitemap",
  "/_next",
  "/robots.txt",
  "/favicon.ico",
  "/sitemap.xml",
  "/sitemap-index.xml",
  "/admin?x=1",
  "/admin#frag",
  "/admin\\panel",
  "/../etc",
  "/admin/../..",
  "/ad min",
  "/%2e%2e/admin",
  "/%2fadmin",
  "/admin!",
  "/admin@home",
  "/admin:8080",
]

describe("the CLI's admin-path rules match the application's", () => {
  it.each(CASES)("agrees about %j", (input) => {
    const fromCli = cliValidate(input)
    const fromApp = appValidate(input)

    expect(fromCli.ok, `disagreement on ${JSON.stringify(input)}`).toBe(fromApp.ok)
    if (fromCli.ok && fromApp.ok) {
      // Not just "both accepted" — both must normalize to the SAME path, or the
      // installer writes one value and the application serves another.
      expect(fromCli.value).toBe(fromApp.value)
    }
  })

  it.each([null, undefined, 42, {}, []])("agrees about the non-string %j", (input) => {
    expect(cliValidate(input as never).ok).toBe(appValidate(input as never).ok)
  })
})

describe("what both implementations refuse", () => {
  it("refuses the internal route, so the installer can never write it", () => {
    // `/admin-panel` is where the App Router files live. Writing it into
    // FLOWCMS_ADMIN_PATH would point the public path at the private one.
    expect(cliValidate("/admin-panel").ok).toBe(false)
    expect(appValidate("/admin-panel").ok).toBe(false)
  })

  it("refuses the site root", () => {
    expect(cliValidate("/").ok).toBe(false)
  })

  it("refuses query strings, fragments and traversal", () => {
    for (const input of ["/admin?x=1", "/admin#f", "/../x", "/%2e%2e/x"]) {
      expect(cliValidate(input).ok, input).toBe(false)
    }
  })
})

describe("what both implementations accept", () => {
  it("accepts a nested path", () => {
    expect(cliValidate("/manage/cms")).toEqual({ ok: true, value: "/manage/cms" })
  })

  it.each(["admin", "/admin/", " /admin ", "//admin//"])(
    "repairs the harmless mistake %j into /admin",
    (input) => {
      // A missing leading slash, a trailing one, surrounding whitespace, a
      // doubled separator: an operator's intent is obvious, and refusing would
      // be pedantry.
      //
      // Asserted on the whole result rather than on `.value`, which the
      // discriminated union does not expose until `ok` is known — and a test
      // that reached past that would be testing something the type says cannot
      // be read.
      expect(cliValidate(input)).toEqual({ ok: true, value: "/admin" })
    },
  )
})
