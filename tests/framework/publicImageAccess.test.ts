import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Who may read a stored image WITHOUT a session.
 *
 * The rule is REFERENCE, not prefix: a key is public only because something
 * published points at it. This file exists because Phase 2 adds one more
 * referrer to that list — the site's own logo and favicon — and a change to
 * this function is a change to what anonymous visitors can read, which is not
 * something to make without a test saying exactly what moved.
 */

const findFirstPost = vi.fn()
const findFirstPage = vi.fn()

vi.mock("@/db/client", () => ({
  db: {
    query: {
      blogPosts: { findFirst: (...a: unknown[]) => findFirstPost(...a) },
      customPages: { findFirst: (...a: unknown[]) => findFirstPage(...a) },
    },
  },
}))

// Drizzle's expression builders are irrelevant here — this test is about which
// SOURCES are consulted, not about the SQL they compile to.
vi.mock("@/db/tables", () => ({
  blogPosts: { featuredImageKey: "featuredImageKey", ogImageKey: "ogImageKey", isPublished: "isPublished", deletedAt: "deletedAt", content: "content" },
  customPages: { ogImageKey: "ogImageKey", isPublished: "isPublished", content: "content" },
}))

const getSettingsRow = vi.fn()
vi.mock("@/Framework/Settings/SettingsService", () => ({
  getSettingsRow: () => getSettingsRow(),
}))

vi.mock("@/Framework/Redis/CacheService", () => ({
  // Pass-through: caching is not what is under test, and a real cache would
  // make one test's answer leak into the next.
  CacheService: { remember: (_k: string, _ttl: number, fn: () => unknown) => fn() },
}))

const { isPubliclyReferencedImage } = await import("@/Framework/Storage/publicImageAccess")

beforeEach(() => {
  findFirstPost.mockReset().mockResolvedValue(undefined)
  findFirstPage.mockReset().mockResolvedValue(undefined)
  getSettingsRow.mockReset().mockResolvedValue(null)
})

describe("keys published content refers to", () => {
  it("allows a key a published post points at", async () => {
    findFirstPost.mockResolvedValueOnce({ id: "p1" })

    expect(await isPubliclyReferencedImage("posts/hero.png")).toBe(true)
  })

  it("allows a key a published page points at", async () => {
    findFirstPage.mockResolvedValueOnce({ id: "c1" })

    expect(await isPubliclyReferencedImage("pages/og.png")).toBe(true)
  })

  it("allows a key that appears inside published content", async () => {
    // First call is the featured/og lookup, second is the content scan.
    findFirstPost.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: "p2" })

    expect(await isPubliclyReferencedImage("posts/inline.png")).toBe(true)
  })

  it("refuses a key nothing published refers to", async () => {
    expect(await isPubliclyReferencedImage("private/contract.png")).toBe(false)
  })
})

describe("the site's own logo and favicon", () => {
  /**
   * THE ONE AUTHORIZATION CHANGE IN PHASE 2, and it closes a bug rather than
   * opening a door.
   *
   * `toBrandView` in `src/Modules/Public/ViewModels/index.ts` already renders
   * the logo as `publicImagePath(brand.logoKey)`, and the default theme's
   * Layout already puts that in an `<img>` on every public page. But this
   * function never consulted the settings row, so the route answered 404 and
   * the site logo did not render at all unless the key happened to appear in
   * some published post's body.
   *
   * These are two exact-match keys from the singleton settings row — not a
   * prefix, not a pattern. They name assets whose entire purpose is to appear
   * on every anonymous page, and only an admin can set them, so nothing becomes
   * readable that an admin could not already publish deliberately.
   */
  it("allows the configured logo", async () => {
    getSettingsRow.mockResolvedValue({ logoKey: "brand/logo.png", faviconKey: null })

    expect(await isPubliclyReferencedImage("brand/logo.png")).toBe(true)
  })

  it("allows the configured favicon", async () => {
    getSettingsRow.mockResolvedValue({ logoKey: null, faviconKey: "brand/icon.png" })

    expect(await isPubliclyReferencedImage("brand/icon.png")).toBe(true)
  })

  it("does not allow some other key just because a logo is configured", async () => {
    getSettingsRow.mockResolvedValue({ logoKey: "brand/logo.png", faviconKey: "brand/icon.png" })

    expect(await isPubliclyReferencedImage("private/payroll.png")).toBe(false)
  })

  it("does not treat an unset logo as matching anything", async () => {
    // The trap: `key === row.logoKey` with both sides null-ish. If a caller
    // ever reached here with an empty key and the logo were unset, a loose
    // comparison would authorise it.
    getSettingsRow.mockResolvedValue({ logoKey: null, faviconKey: null })

    expect(await isPubliclyReferencedImage("")).toBe(false)
    expect(await isPubliclyReferencedImage("anything.png")).toBe(false)
  })

  it("answers without a settings row at all", async () => {
    getSettingsRow.mockResolvedValue(null)

    expect(await isPubliclyReferencedImage("anything.png")).toBe(false)
  })

  it("checks the settings row before running the content scan", async () => {
    getSettingsRow.mockResolvedValue({ logoKey: "brand/logo.png", faviconKey: null })

    await isPubliclyReferencedImage("brand/logo.png")

    // The content scan is a LIKE over every published post's body. The logo is
    // requested on every single public page render, so it must never reach it.
    expect(findFirstPost).not.toHaveBeenCalled()
  })
})
