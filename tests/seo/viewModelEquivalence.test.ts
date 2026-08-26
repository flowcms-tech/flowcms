import { describe, expect, it, vi } from "vitest"

/**
 * The view models must hand the theme exactly the structured data the old
 * components built for themselves.
 *
 * `tests/seo/jsonLdPinning.test.ts` pins the BUILDERS, and the builders were
 * not touched by Phase 6.0 — so on their own those snapshots would have passed
 * even if the hoist had wired an argument wrongly. `buildTaxonomyJsonLd` takes
 * `(taxonomy, kind, …)` while the view model is called `(taxonomy, kind, …)`;
 * transposing those two produces a graph that is structurally valid, silently
 * wrong, and snapshot-clean.
 *
 * This test closes that gap by asserting the view model's `jsonLd` is deeply
 * equal to calling the builder directly with the arguments the pre-refactor
 * component used.
 */

vi.mock("@/Framework/Settings/SettingsService", () => ({
  getBaseUrl: async () => "https://example.test",
  getBrand: async () => ({ siteName: "FlowCMS Site", tagline: null, logoKey: null, faviconKey: null }),
  getMetaTemplates: async () => ({
    postTitle: null, postDescription: null,
    categoryTitle: null, categoryDescription: null,
    tagTitle: null, tagDescription: null,
    authorTitle: null, authorDescription: null,
  }),
}))

// The post view fetches related and series posts. Those are queries, and the
// point here is the wiring, not the database.
vi.mock("@/Modules/Blog/Public/Queries/publicBlogQueries", () => ({
  getRelatedPosts: async () => [],
  getSeriesPosts: async () => [],
}))

import {
  buildBlogPostView,
  buildBlogIndexView,
  buildArchiveView,
  buildAuthorArchiveView,
} from "@/Modules/Blog/Public/ViewModels"
import {
  buildPostJsonLd,
  buildBlogIndexJsonLd,
  buildTaxonomyJsonLd,
} from "@/Modules/Blog/Public/Values/buildJsonLd"
import { buildAuthorJsonLd } from "@/Modules/Blog/Public/Values/buildAuthorJsonLd"
import type { PublicPost, PublicPostSummary, PublicTaxonomy } from "@/Modules/Blog/Public/Types"
import type { PublicAuthor } from "@/Modules/Blog/Public/Queries/authorQueries"
import type { PublicPostQuestion } from "@/Modules/Blog/Public/Queries/questionQueries"

const AUTHOR: PublicPostSummary["author"] = {
  id: "author-1", name: "Ada Lovelace", isRealAuthor: true, slug: "ada-lovelace",
  jobTitle: "Staff Writer", credentials: "MSc", bio: "Writes about computing.",
  avatarUrl: "https://example.test/a.jpg", avatarAltText: "Ada", sameAs: [],
}

const SUMMARY: PublicPostSummary = {
  id: "post-1", title: "A Post", slug: "a-post", excerpt: "Excerpt.",
  featuredImageUrl: "https://example.test/c.jpg", featuredImageAltText: "Cover",
  publishedAt: new Date("2026-01-15T09:00:00.000Z"), wordCount: 900,
  categories: [{ id: "cat-1", name: "Guides", slug: "guides" }],
  tags: [{ id: "tag-1", name: "Portable", slug: "portable" }],
  author: AUTHOR,
}

const POST: PublicPost = {
  ...SUMMARY,
  content: "<h2 id='a'>A</h2><p>Body.</p><h2 id='b'>B</h2><p>More.</p>",
  metaTitle: null, metaDescription: null, canonicalUrl: null,
  ogImageUrl: "https://example.test/og.jpg", isIndexable: true,
  updatedAt: new Date("2026-02-01T12:00:00.000Z"),
  contentUpdatedAt: null, isCornerstone: false,
  seriesId: null, seriesPosition: null, series: null,
  primaryCategoryId: null, schemaType: "BlogPosting", schemaData: null,
  speakableSelectors: [], focusKeyword: null,
  faqs: [{ id: "faq-1", question: "Portable?", answer: "Yes." }],
}

const QUESTIONS: PublicPostQuestion[] = [
  { id: "q-1", question: "MySQL?", answer: "And MariaDB.", askerName: null },
]

const TAXONOMY: PublicTaxonomy = {
  id: "cat-1", name: "Guides", slug: "guides", description: null,
  metaTitle: null, metaDescription: null, canonicalUrl: null,
  isIndexable: true, archiveIntro: null, indexablePostCount: 2,
}

const PUBLIC_AUTHOR: PublicAuthor = {
  id: "author-1", name: "Ada Lovelace", slug: "ada-lovelace",
  jobTitle: "Staff Writer", credentials: "MSc", bio: "Writes.",
  avatarUrl: null, avatarAltText: null, sameAs: [],
  metaTitle: null, metaDescription: null, canonicalUrl: null, isIndexable: true,
}

describe("view models emit the same JSON-LD the components used to build", () => {
  it("post", async () => {
    const view = await buildBlogPostView(POST, QUESTIONS)
    expect(view.jsonLd).toEqual(await buildPostJsonLd(POST, QUESTIONS))
  })

  it("blog index", async () => {
    const view = await buildBlogIndexView([SUMMARY], 2, 5)
    expect(view.jsonLd).toEqual(await buildBlogIndexJsonLd([SUMMARY], 2))
  })

  it("category archive", async () => {
    const view = await buildArchiveView(TAXONOMY, "category", [SUMMARY], 1, 3)
    expect(view.jsonLd).toEqual(await buildTaxonomyJsonLd(TAXONOMY, "category", [SUMMARY], 1))
  })

  it("tag archive — kind must not be transposed with taxonomy", async () => {
    const tag: PublicTaxonomy = { ...TAXONOMY, slug: "portable", name: "Portable" }
    const view = await buildArchiveView(tag, "tag", [SUMMARY], 1, 3)
    expect(view.jsonLd).toEqual(await buildTaxonomyJsonLd(tag, "tag", [SUMMARY], 1))
    // And the emitted URL really is the tag path, which is what a transposed
    // pair would break.
    expect(JSON.stringify(view.jsonLd)).toContain("/blog/tag/portable")
  })

  it("author archive — page is carried through", async () => {
    const view = await buildAuthorArchiveView(PUBLIC_AUTHOR, [SUMMARY], 2, 4)
    expect(view.jsonLd).toEqual(await buildAuthorJsonLd(PUBLIC_AUTHOR, [SUMMARY], 2))
  })
})

describe("the post view resolves everything the component used to compute", () => {
  it("returns TOC html with anchor ids injected, not the raw content", async () => {
    // Headings deliberately WITHOUT ids, so the injection is observable. The
    // distinction matters: rendering post.content instead of this html leaves
    // every TOC link pointing at nothing.
    const unanchored: PublicPost = {
      ...POST,
      content: "<h2>First</h2><p>Body.</p><h2>Second</h2><p>More.</p>",
    }
    const view = await buildBlogPostView(unanchored, [])

    expect(view.toc.headings.length).toBeGreaterThan(0)
    expect(view.toc.html).not.toBe(unanchored.content)
    expect(view.toc.html).toContain("id=")
    for (const heading of view.toc.headings) {
      expect(view.toc.html).toContain(heading.id)
    }
  })

  it("resolves the primary category with the alphabetical fallback", async () => {
    const view = await buildBlogPostView(POST, [])
    expect(view.primaryCategory?.slug).toBe("guides")
  })

  it("carries the same questions array it marked up", async () => {
    const view = await buildBlogPostView(POST, QUESTIONS)
    expect(view.questions).toBe(QUESTIONS)
    expect(JSON.stringify(view.jsonLd)).toContain("MySQL?")
  })

  it("parses schema payloads for the renderer", async () => {
    // Two steps minimum — the validator rejects a single-step HowTo because
    // Google rejects the markup, and a partial HowTo is a Rich Results *error*
    // where emitting none is merely a missing enhancement.
    const howTo: PublicPost = {
      ...POST,
      schemaType: "HowTo",
      schemaData: JSON.stringify({
        steps: [
          { name: "One", text: "Do the first thing." },
          { name: "Two", text: "Do the second thing." },
        ],
      }),
    }
    const view = await buildBlogPostView(howTo, [])
    expect(view.howTo).toBeTruthy()
    expect(view.howTo?.steps).toHaveLength(2)
    expect(view.review).toBeFalsy()
    expect(view.video).toBeFalsy()
  })

  it("returns null schema payloads when the type does not match", async () => {
    const view = await buildBlogPostView(POST, [])
    expect(view.howTo).toBeNull()
    expect(view.review).toBeNull()
    expect(view.video).toBeNull()
  })
})
