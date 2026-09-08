import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * The admin root redirects to the dashboard.
 *
 * `/admin` (or whatever FLOWCMS_ADMIN_PATH names) is the address people type,
 * bookmark and get sent by the setup flow. The proxy rewrites it onto
 * `/admin-panel`, and for as long as that directory had no `page.tsx` the
 * rewrite landed on nothing: an authenticated visitor typing the admin root got
 * the site's 404 page. Unauthenticated visitors never saw it, because the
 * proxy's `authorized` callback redirected them to the login page before the
 * rewrite — which is exactly why the gap survived: every test and every fresh
 * install exercised the login path, and only a signed-in operator returning to
 * the bare root ever hit the missing page.
 *
 * Two things are pinned here. The page exists at the internal root, and it
 * redirects to the PUBLIC dashboard path — derived from the configured admin
 * path, never the internal one — so an operator who moved the panel still
 * lands somewhere real.
 */

const { redirect } = vi.hoisted(() => ({
  // Next's `redirect()` never returns: it throws a control-flow error that the
  // router catches. The mock does the same so a page that redirects and then
  // keeps rendering is caught as the bug it would be in production.
  redirect: vi.fn((to: string): never => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  }),
}))

vi.mock("next/navigation", () => ({ redirect }))

async function loadAdminRootPage(configuredAdminPath: string) {
  // adminPath.ts resolves FLOWCMS_ADMIN_PATH once at module load, so the env
  // must be set before a fresh import — the module registry is reset for the
  // same reason.
  vi.stubEnv("FLOWCMS_ADMIN_PATH", configuredAdminPath)
  vi.resetModules()
  const mod = await import("@/app/admin-panel/page")
  return mod.default
}

afterEach(() => {
  vi.unstubAllEnvs()
  redirect.mockClear()
})

describe("admin root page", () => {
  it("redirects the default admin root to its dashboard", async () => {
    const AdminRootPage = await loadAdminRootPage("")

    await expect(Promise.resolve().then(() => AdminRootPage())).rejects.toThrow("NEXT_REDIRECT")

    expect(redirect).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith("/admin/dashboard")
  })

  it("follows a configured admin path rather than the default", async () => {
    const AdminRootPage = await loadAdminRootPage("/ngnt")

    await expect(Promise.resolve().then(() => AdminRootPage())).rejects.toThrow("NEXT_REDIRECT")

    expect(redirect).toHaveBeenCalledWith("/ngnt/dashboard")
  })

  it("never redirects onto the internal route", async () => {
    const AdminRootPage = await loadAdminRootPage("/ngnt")

    await expect(Promise.resolve().then(() => AdminRootPage())).rejects.toThrow()

    const [target] = redirect.mock.calls[0]
    expect(target).not.toContain("admin-panel")
  })
})
