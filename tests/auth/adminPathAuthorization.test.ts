import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"
import { authConfig } from "@/Framework/Auth/auth.config"

/**
 * The `authorized` callback must REFUSE unauthenticated admin requests by
 * returning a redirect Response — not merely by returning `false`.
 *
 * This is not a stylistic preference, it is forced by how next-auth dispatches.
 * In `next-auth/lib/index.js` the branches are:
 *
 *     if (authorized instanceof Response)   → use that response
 *     else if (userMiddlewareOrRoute)       → run the wrapper, ignore `authorized`
 *     else if (!authorized)                 → redirect to the sign-in page
 *
 * They are mutually exclusive. While the proxy was `export const proxy = auth`
 * there was no wrapper, so a `false` return reached the third branch and the
 * redirect happened for free. The moment the proxy wrapped `auth()` to perform
 * the admin-path rewrite, the second branch started winning and a `false`
 * return became a silent no-op: every protected admin page rendered for
 * anonymous visitors while `authorized` dutifully computed the correct answer
 * and had it thrown away.
 *
 * That regression is invisible to a type checker and to every test that does
 * not actually exercise this callback, which is why it is pinned here.
 */

function requestFor(pathname: string): NextRequest {
  return new NextRequest(`http://localhost:3000${pathname}`)
}

type AuthorizedArgs = Parameters<NonNullable<typeof authConfig.callbacks.authorized>>[0]

function callAuthorized(pathname: string, auth: AuthorizedArgs["auth"]) {
  return authConfig.callbacks.authorized({
    request: requestFor(pathname),
    auth,
  } as AuthorizedArgs)
}

const SIGNED_IN = {
  user: { id: "user-1", role: "owner" },
  expires: new Date(Date.now() + 60_000).toISOString(),
} as unknown as AuthorizedArgs["auth"]

describe("authorized() on admin requests", () => {
  it("returns a redirect Response for an unauthenticated protected page", async () => {
    const result = await callAuthorized("/admin/dashboard", null)

    // A bare `false` would be silently discarded by the wrapper dispatch.
    expect(result).toBeInstanceOf(Response)

    const response = result as Response
    expect(response.status).toBeGreaterThanOrEqual(300)
    expect(response.status).toBeLessThan(400)

    const location = response.headers.get("location")
    expect(location).toBeTruthy()
    expect(new URL(location as string).pathname).toBe("/admin/login")
  })

  it("sends the user to the PUBLIC login path, never the internal route", async () => {
    const result = (await callAuthorized("/admin/settings/global", null)) as Response
    const location = new URL(result.headers.get("location") as string)

    expect(location.pathname).toBe("/admin/login")
    expect(location.pathname).not.toContain("admin-panel")
  })

  it("preserves where the user was going", async () => {
    const result = (await callAuthorized("/admin/blog/posts", null)) as Response
    const location = new URL(result.headers.get("location") as string)

    expect(location.searchParams.get("callbackUrl")).toContain("/admin/blog/posts")
  })

  it("allows the login page itself through, so there is no redirect loop", async () => {
    expect(await callAuthorized("/admin/login", null)).toBe(true)
  })

  it("allows an authenticated user through so the rewrite can run", async () => {
    expect(await callAuthorized("/admin/dashboard", SIGNED_IN)).toBe(true)
  })

  it("refuses a session whose token was invalidated (no user id)", async () => {
    const noId = { user: {}, expires: "" } as unknown as AuthorizedArgs["auth"]
    expect(await callAuthorized("/admin/dashboard", noId)).toBeInstanceOf(Response)
  })
})
