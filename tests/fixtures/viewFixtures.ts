import type {
  ArchiveView,
  AuthorArchiveView,
  BlogIndexView,
  BlogPostView,
  BrandView,
  HomeView,
  NotFoundView,
  PageView,
  PublicAuthor,
  PublicCustomPage,
  PublicPost,
  PublicPostSummary,
  PublicTaxonomy,
} from "@/Themes/contract"

/**
 * Fully-populated view models, for rendering themes without a database.
 *
 * Typed against the contract with NO casts. A fixture that needs `as never` to
 * compile is a fixture describing data the application never produces — the
 * Phase 6.0 pinning test learned that the expensive way, by pinning a graph
 * built from a byline passed where an author record belonged.
 *
 * Every optional field is filled in here. The empty and minimal cases get their
 * own overrides at the call site, so a test that means "no posts" says so.
 */

export const BRAND: BrandView = {
  siteName: "Example Site",
  tagline: "Words about things",
  logoUrl: "/api/public/images/brand/logo.png",
  logoAltText: "Example Site",
}

export const BYLINE: PublicPostSummary["author"] = {
  id: "author-1",
  name: "Ada Lovelace",
  isRealAuthor: true,
  slug: "ada-lovelace",
  jobTitle: "Staff Writer",
  credentials: "MSc",
  bio: "Writes about computing.",
  avatarUrl: "/api/public/images/authors/ada.jpg",
  avatarAltText: "Ada Lovelace",
  sameAs: ["https://example.test/profile"],
}

export const SUMMARY: PublicPostSummary = {
  id: "post-1",
  title: "A Post About Everything",
  slug: "a-post-about-everything",
  excerpt: "An excerpt that stands in for the description.",
  featuredImageUrl: "/api/public/images/posts/cover.jpg",
  featuredImageAltText: "A cover image",
  publishedAt: new Date("2026-01-15T09:00:00.000Z"),
  wordCount: 1200,
  categories: [
    { id: "cat-1", name: "Guides", slug: "guides" },
    { id: "cat-2", name: "Reference", slug: "reference" },
  ],
  tags: [{ id: "tag-1", name: "Portable", slug: "portable" }],
  author: BYLINE,
}

export const POST: PublicPost = {
  ...SUMMARY,
  content: "<h2>One</h2><p>Body copy.</p><h2>Two</h2><p>More.</p>",
  metaTitle: null,
  metaDescription: null,
  canonicalUrl: null,
  ogImageUrl: "/api/public/images/posts/og.jpg",
  isIndexable: true,
  updatedAt: new Date("2026-02-01T12:00:00.000Z"),
  contentUpdatedAt: new Date("2026-01-30T08:00:00.000Z"),
  isCornerstone: true,
  seriesId: "series-1",
  seriesPosition: 2,
  series: { id: "series-1", name: "A Series", slug: "a-series" },
  primaryCategoryId: "cat-2",
  schemaType: "HowTo",
  schemaData: null,
  speakableSelectors: ["h1"],
  focusKeyword: "portable",
  faqs: [{ id: "faq-1", question: "Is it portable?", answer: "Yes." }],
}

export const AUTHOR: PublicAuthor = {
  id: "author-1",
  name: "Ada Lovelace",
  slug: "ada-lovelace",
  jobTitle: "Staff Writer",
  credentials: "MSc",
  bio: "Writes about computing.",
  avatarUrl: "/api/public/images/authors/ada.jpg",
  avatarAltText: "Ada Lovelace",
  sameAs: ["https://example.test/profile"],
  metaTitle: null,
  metaDescription: null,
  canonicalUrl: null,
  isIndexable: true,
}

export const TAXONOMY: PublicTaxonomy = {
  id: "cat-1",
  name: "Guides",
  slug: "guides",
  description: "Everything explained.",
  metaTitle: null,
  metaDescription: null,
  canonicalUrl: null,
  isIndexable: true,
  archiveIntro: "Intro copy for page one.",
  indexablePostCount: 3,
}

export const PAGE_RECORD: PublicCustomPage = {
  id: "page-1",
  title: "About Us",
  path: "/about-us",
  content: "<p>Who we are.</p>",
  metaTitle: null,
  metaDescription: "A short description.",
  ogImageUrl: null,
  canonicalUrl: null,
  isIndexable: true,
  publishedAt: new Date("2026-01-10T12:00:00.000Z"),
  updatedAt: new Date("2026-02-01T12:00:00.000Z"),
}

/** A graph shaped like the ones core builds. Themes only serialize it. */
export const JSON_LD = { "@context": "https://schema.org", "@type": "WebPage", name: "Example" }

export const HOME_VIEW: HomeView = { brand: BRAND, jsonLd: JSON_LD }

export const NOT_FOUND_VIEW: NotFoundView = { brand: BRAND }

export const PAGE_VIEW: PageView = {
  page: PAGE_RECORD,
  jsonLd: JSON_LD,
  html: "<p>Who we are.</p>",
}

export const BLOG_INDEX_VIEW: BlogIndexView = {
  posts: [SUMMARY],
  page: 1,
  totalPages: 3,
  jsonLd: JSON_LD,
}

export const ARCHIVE_VIEW: ArchiveView = {
  taxonomy: TAXONOMY,
  kind: "category",
  posts: [SUMMARY],
  page: 1,
  totalPages: 2,
  jsonLd: JSON_LD,
}

export const AUTHOR_ARCHIVE_VIEW: AuthorArchiveView = {
  author: AUTHOR,
  posts: [SUMMARY],
  page: 1,
  totalPages: 2,
  jsonLd: JSON_LD,
}

export const BLOG_POST_VIEW: BlogPostView = {
  post: POST,
  // A stand-in for the form core renders. The fixture deliberately does not
  // import the real one: it is a client component, and a theme render test that
  // needed it would be testing core's form rather than the theme's placement.
  askQuestion: null,
  questions: [{ id: "q-1", question: "Does it work?", answer: "Yes.", askerName: "Reader" }],
  related: [{ ...SUMMARY, id: "post-2", slug: "another-post", title: "Another Post" }],
  seriesPosts: [
    { id: "post-1", title: "A Post About Everything", slug: "a-post-about-everything", seriesPosition: 2, isPublished: true },
    { id: "post-3", title: "The First One", slug: "the-first-one", seriesPosition: 1, isPublished: true },
  ],
  toc: {
    html: "<h2 id='one'>One</h2><p>Body copy.</p><h2 id='two'>Two</h2><p>More.</p>",
    headings: [
      { id: "one", text: "One", level: 2, children: [] },
      { id: "two", text: "Two", level: 2, children: [] },
      { id: "three", text: "Three", level: 2, children: [] },
    ],
    hasToc: true,
  },
  primaryCategory: { id: "cat-2", name: "Reference", slug: "reference" },
  howTo: {
    totalTime: "PT30M",
    estimatedCost: "$10",
    tools: ["A screwdriver"],
    supplies: ["Two screws"],
    steps: [
      { name: "Step one", text: "Do the first thing.", imageKey: "steps/one.jpg" },
      { name: "Step two", text: "Do the second thing." },
    ],
  },
  review: {
    itemName: "The Thing",
    itemType: "Product",
    rating: 4.5,
    bestRating: 5,
    worstRating: 1,
    pros: ["Sturdy"],
    cons: ["Heavy"],
  },
  video: {
    contentUrl: "https://example.test/video.mp4",
    uploadDate: "2026-01-15",
    duration: "PT5M",
  },
  jsonLd: JSON_LD,
}
