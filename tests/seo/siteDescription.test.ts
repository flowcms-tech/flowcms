import { describe, expect, it, vi } from "vitest"

/**
 * The blog index description and the RSS channel description.
 *
 * Both used to be the literal sentence *"Guides and advice on locks, keys, and
 * home security."* — one former customer's subject matter, hardcoded, shipped
 * on every FlowCMS install. It went out in the `<meta name="description">` of
 * `/blog` and in the `<description>` of the feed, so every install advertised
 * a locksmith blog regardless of what it actually published.
 *
 * The replacement is the operator's own tagline, which Settings already has.
 * Where no tagline is set the two surfaces degrade differently, on purpose:
 *
 *   - `/blog` metadata OMITS the description. A search engine writes a better
 *     one from the page than any filler we could invent, and inventing one is
 *     how the locksmith sentence got there in the first place.
 *   - The RSS channel CANNOT omit it — `<description>` is required on
 *     `<channel>` by RSS 2.0 — so it falls back to the smallest neutral
 *     statement of fact about the feed, naming the site and nothing else.
 */

let tagline: string | null = null
const siteName = "Example Site"

vi.mock("@/Framework/Settings/SettingsService", () => ({
  getBaseUrl: async () => "https://example.test",
  getBrand: async () => ({
    siteName,
    tagline,
    logoKey: null,
    logoAltText: null,
    faviconKey: null,
  }),
  getMetaTemplates: async () => ({
    postTitle: "%title% %sep% %sitename%",
    postDescription: "%excerpt%",
    categoryTitle: "%title% %sep% %sitename%",
    tagTitle: "%title% %sep% %sitename%",
    authorTitle: "%title% %sep% %sitename%",
    separator: "|",
  }),
}))

import {
  buildBlogIndexMetadata,
  feedChannelDescription,
  resolveSeoContext,
} from "@/Modules/Blog/Public/Values/buildPostMetadata"

const RESIDUE = /locks, keys|locksmith|home security/i

describe("resolveSeoContext", () => {
  it("carries the tagline alongside the site name", async () => {
    tagline = "Notes on gardening"
    const ctx = await resolveSeoContext()
    expect(ctx.siteName).toBe("Example Site")
    expect(ctx.tagline).toBe("Notes on gardening")
  })

  it("carries null when no tagline is configured", async () => {
    tagline = null
    expect((await resolveSeoContext()).tagline).toBeNull()
  })
})

describe("blog index metadata", () => {
  it("uses the operator's tagline as the description", async () => {
    tagline = "Notes on gardening"
    const meta = await buildBlogIndexMetadata(1, 3)
    expect(meta.description).toBe("Notes on gardening")
    expect(meta.openGraph?.description).toBe("Notes on gardening")
  })

  it("omits the description entirely when no tagline is set", async () => {
    // Not an empty string: an empty `<meta name="description">` is a worse
    // signal than no tag at all, and Next emits the key if it is present.
    tagline = null
    const meta = await buildBlogIndexMetadata(1, 3)
    expect(meta.description).toBeUndefined()
    expect(meta.openGraph).not.toHaveProperty("description")
  })

  it("emits no trace of the former customer's subject matter", async () => {
    tagline = null
    expect(JSON.stringify(await buildBlogIndexMetadata(1, 1))).not.toMatch(RESIDUE)
    tagline = "Notes on gardening"
    expect(JSON.stringify(await buildBlogIndexMetadata(2, 4))).not.toMatch(RESIDUE)
  })

  it("still builds the title and canonical it always did", async () => {
    // The residue removal must not disturb the rest of the metadata.
    tagline = null
    const meta = await buildBlogIndexMetadata(2, 4)
    expect(meta.title).toContain("Blog")
    expect(meta.alternates?.canonical).toBe("https://example.test/blog?page=2")
  })
})

describe("feedChannelDescription", () => {
  it("prefers the operator's tagline", () => {
    expect(feedChannelDescription("Example Site", "Notes on gardening")).toBe("Notes on gardening")
  })

  it("falls back to a neutral statement naming the site", () => {
    // RSS 2.0 requires <description> on <channel>, so unlike the meta tag this
    // one cannot be omitted. The fallback states what the feed is and claims
    // nothing about what the site sells.
    expect(feedChannelDescription("Example Site", null)).toBe("Latest posts from Example Site")
  })

  it("treats a blank tagline as unset", () => {
    expect(feedChannelDescription("Example Site", "   ")).toBe("Latest posts from Example Site")
  })

  it("emits no trace of the former customer's subject matter", () => {
    expect(feedChannelDescription("Example Site", null)).not.toMatch(RESIDUE)
    expect(feedChannelDescription("A Locksmith Co", null)).toBe("Latest posts from A Locksmith Co")
  })
})
