import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * SEO output, pinned byte-for-byte across the Phase 6.0 view-model hoist.
 *
 * 6.0 moves JSON-LD construction out of the public presentation modules and
 * into the route/view-model layer. That is a pure refactor: not one character
 * of emitted markup should change. But "should" is doing a lot of work in that
 * sentence — structured data is exactly the kind of output nobody looks at
 * until a Rich Results warning appears weeks later, and by then the diff that
 * caused it is buried under a theme system.
 *
 * So these snapshots are taken BEFORE the refactor and must survive it
 * unchanged. If one moves, the refactor changed behaviour and the diff says
 * precisely how.
 *
 * Settings are mocked rather than read: the assertion is about the shape of the
 * graph the builders produce, and a test that needs a database to check its own
 * escaping is a test that stops being run.
 */

vi.mock("@/Framework/Settings/SettingsService", () => ({
  getBaseUrl: async () => "https://example.test",
  getBrand: async () => ({ siteName: "FlowCMS Site", tagline: null, logoKey: null, faviconKey: null }),
  getMetaTemplates: async () => ({
    postTitle: null,
    postDescription: null,
    categoryTitle: null,
    categoryDescription: null,
    tagTitle: null,
    tagDescription: null,
    authorTitle: null,
    authorDescription: null,
  }),
}))

import {
  buildPostJsonLd,
  buildBlogIndexJsonLd,
  buildTaxonomyJsonLd,
} from "@/Modules/Blog/Public/Values/buildJsonLd"
import { buildAuthorJsonLd } from "@/Modules/Blog/Public/Values/buildAuthorJsonLd"
import { buildPostMetadata } from "@/Modules/Blog/Public/Values/buildPostMetadata"
import type {
  PublicPost,
  PublicPostSummary,
  PublicTaxonomy,
} from "@/Modules/Blog/Public/Types"
import type { PublicAuthor } from "@/Modules/Blog/Public/Queries/authorQueries"

const AUTHOR: PublicPostSummary["author"] = {
  id: "author-1",
  name: "Ada Lovelace",
  isRealAuthor: true,
  slug: "ada-lovelace",
  jobTitle: "Staff Writer",
  credentials: "MSc",
  bio: "Writes about computing.",
  avatarUrl: "https://example.test/api/public/images/authors/ada.jpg",
  avatarAltText: "Ada Lovelace",
  sameAs: ["https://example.test/profile"],
}

/**
 * The archive author is a different type from the post byline — the byline
 * carries `isRealAuthor`, the archive record carries its own SEO fields. An
 * earlier draft of this test passed the byline with an `as never` cast, which
 * compiled, produced a snapshot, and pinned output the application never emits.
 * No casts here for exactly that reason.
 */
const PUBLIC_AUTHOR: PublicAuthor = {
  id: "author-1",
  name: "Ada Lovelace",
  slug: "ada-lovelace",
  jobTitle: "Staff Writer",
  credentials: "MSc",
  bio: "Writes about computing.",
  avatarUrl: "https://example.test/api/public/images/authors/ada.jpg",
  avatarAltText: "Ada Lovelace",
  sameAs: ["https://example.test/profile"],
  metaTitle: null,
  metaDescription: null,
  canonicalUrl: null,
  isIndexable: true,
}

const SUMMARY: PublicPostSummary = {
  id: "post-1",
  title: "A Post About Everything",
  slug: "a-post-about-everything",
  excerpt: "An excerpt that stands in for the description.",
  featuredImageUrl: "https://example.test/api/public/images/posts/cover.jpg",
  featuredImageAltText: "A cover image",
  publishedAt: new Date("2026-01-15T09:00:00.000Z"),
  wordCount: 1200,
  categories: [
    { id: "cat-1", name: "Guides", slug: "guides" },
    { id: "cat-2", name: "Reference", slug: "reference" },
  ],
  tags: [{ id: "tag-1", name: "Portable", slug: "portable" }],
  author: AUTHOR,
}

const POST: PublicPost = {
  ...SUMMARY,
  content: "<h2 id='one'>One</h2><p>Body copy.</p><h2 id='two'>Two</h2><p>More.</p>",
  metaTitle: null,
  metaDescription: null,
  canonicalUrl: null,
  ogImageUrl: "https://example.test/api/public/images/posts/og.jpg",
  isIndexable: true,
  updatedAt: new Date("2026-02-01T12:00:00.000Z"),
  contentUpdatedAt: new Date("2026-01-30T08:00:00.000Z"),
  isCornerstone: true,
  seriesId: "series-1",
  seriesPosition: 2,
  series: { id: "series-1", name: "A Series", slug: "a-series" },
  primaryCategoryId: "cat-2",
  schemaType: "BlogPosting",
  schemaData: null,
  speakableSelectors: ["h1", ".summary"],
  focusKeyword: "portable",
  faqs: [{ id: "faq-1", question: "Is it portable?", answer: "Yes." }],
}

const QUESTIONS = [
  { id: "q-1", question: "Does it work on MySQL?", answer: "Yes, and on MariaDB." },
]

const TAXONOMY: PublicTaxonomy = {
  id: "cat-1",
  name: "Guides",
  slug: "guides",
  description: "Everything explained.",
  metaTitle: null,
  metaDescription: null,
  canonicalUrl: null,
  isIndexable: true,
  archiveIntro: "Intro copy.",
  indexablePostCount: 3,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("post JSON-LD", () => {
  it("emits a stable graph", async () => {
    expect(await buildPostJsonLd(POST, QUESTIONS)).toMatchSnapshot()
  })

  it("emits a stable graph with no reader questions", async () => {
    expect(await buildPostJsonLd(POST, [])).toMatchSnapshot()
  })

  it("merges reader questions into the SAME FAQPage node, never a second one", async () => {
    // The rule this pins: two FAQPage nodes on one URL is a duplicate-node
    // warning in the Rich Results Test.
    const graph = JSON.stringify(await buildPostJsonLd(POST, QUESTIONS))
    const faqNodes = graph.match(/"@type":"FAQPage"/g) ?? []
    expect(faqNodes).toHaveLength(1)
    expect(graph).toContain("Does it work on MySQL?")
    expect(graph).toContain("Is it portable?")
  })

  it("emits a stable graph for a HowTo post", async () => {
    const howTo: PublicPost = {
      ...POST,
      schemaType: "HowTo",
      schemaData: JSON.stringify({
        totalTime: "PT30M",
        steps: [
          { name: "Step one", text: "Do the first thing." },
          { name: "Step two", text: "Do the second thing." },
        ],
      }),
    }
    expect(await buildPostJsonLd(howTo, [])).toMatchSnapshot()
  })

  it("honours an explicit canonical URL", async () => {
    const canonical: PublicPost = { ...POST, canonicalUrl: "https://canonical.test/elsewhere" }
    const graph = JSON.stringify(await buildPostJsonLd(canonical, []))
    expect(graph).toContain("https://canonical.test/elsewhere")
  })
})

describe("archive and index JSON-LD", () => {
  it("emits a stable blog index graph", async () => {
    expect(await buildBlogIndexJsonLd([SUMMARY], 1)).toMatchSnapshot()
  })

  it("emits a stable blog index graph for page 2", async () => {
    expect(await buildBlogIndexJsonLd([SUMMARY], 2)).toMatchSnapshot()
  })

  it("emits a stable category graph", async () => {
    expect(await buildTaxonomyJsonLd(TAXONOMY, "category", [SUMMARY], 1)).toMatchSnapshot()
  })

  it("emits a stable tag graph", async () => {
    const tag: PublicTaxonomy = { ...TAXONOMY, slug: "portable", name: "Portable" }
    expect(await buildTaxonomyJsonLd(tag, "tag", [SUMMARY], 1)).toMatchSnapshot()
  })

  it("emits a stable author graph", async () => {
    expect(await buildAuthorJsonLd(PUBLIC_AUTHOR, [SUMMARY], 1)).toMatchSnapshot()
  })
})

describe("post metadata", () => {
  it("emits stable metadata", async () => {
    expect(await buildPostMetadata(POST)).toMatchSnapshot()
  })

  it("emits stable metadata for a non-indexable post", async () => {
    expect(await buildPostMetadata({ ...POST, isIndexable: false })).toMatchSnapshot()
  })
})
