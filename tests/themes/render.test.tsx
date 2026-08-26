import { describe, expect, it } from "vitest"
import { NO_SETTINGS } from "./settingsFixtures"

import { renderToStaticMarkup } from "react-dom/server"
import { getDefaultTheme } from "@/Themes/registry"
import { THEME_SURFACES } from "@/Themes/contract"
import {
  ARCHIVE_VIEW,
  AUTHOR_ARCHIVE_VIEW,
  BLOG_INDEX_VIEW,
  BLOG_POST_VIEW,
  BRAND,
  HOME_VIEW,
  NOT_FOUND_VIEW,
  PAGE_VIEW,
} from "../fixtures/viewFixtures"

/**
 * Every surface of the default theme, actually rendered.
 *
 * `renderToStaticMarkup` rather than a DOM: these are server components in
 * ordinary use, the assertions are about emitted markup, and a suite that needs
 * jsdom to check a heading contains a title is a suite that gets skipped. It
 * also proves a theme is renderable with no database, no request and no Next.js
 * runtime — which is the whole claim the contract makes.
 *
 * The empty cases matter as much as the populated ones. A fresh install has no
 * posts, no menus and no logo, and that is the state in which somebody decides
 * whether this software works.
 */

const theme = getDefaultTheme()

/** Narrow past the optional surfaces. The registry test already proved the
 *  default theme implements all of them, so a missing one here is a bug rather
 *  than a case to handle. */
function surface<K extends (typeof THEME_SURFACES)[number]>(name: K): NonNullable<(typeof theme)[K]> {
  const component = theme[name]
  if (!component) throw new Error(`default theme is missing ${name}`)
  return component as NonNullable<(typeof theme)[K]>
}

const EMPTY_NAV = { slots: {} }

describe("Layout", () => {
  it("renders the site name and wraps its children", () => {
    const html = renderToStaticMarkup(
      <theme.Layout settings={NO_SETTINGS} brand={BRAND} nav={EMPTY_NAV}>
        <p>Page body</p>
      </theme.Layout>,
    )
    expect(html).toContain("Page body")
    expect(html).toContain("Example Site")
  })

  it("renders with no menu items in any slot", () => {
    // Every slot is empty until the Menu subsystem lands in 6.5, so this is not
    // an edge case — it is the only state that currently exists.
    const html = renderToStaticMarkup(
      <theme.Layout settings={NO_SETTINGS} brand={BRAND} nav={EMPTY_NAV}>
        <p>Body</p>
      </theme.Layout>,
    )
    expect(html).toContain("Body")
    // An empty <ul> is announced by a screen reader as a list of zero items, so
    // nav lists are omitted rather than emitted empty.
    expect(html).not.toContain("<ul")
  })

  it("renders the menus it is given", () => {
    const html = renderToStaticMarkup(
      <theme.Layout settings={NO_SETTINGS}
        brand={BRAND}
        nav={{
          slots: {
            primary: [{ label: "About", href: "/about", opensInNewTab: false, children: [] }],
            footer: [
              {
                label: "Docs",
                href: "https://example.test/docs",
                opensInNewTab: true,
                children: [{ label: "Guides", href: "/guides", opensInNewTab: false, children: [] }],
              },
            ],
          },
        }}
      >
        <p>Body</p>
      </theme.Layout>,
    )
    expect(html).toContain(">About<")
    expect(html).toContain(">Guides<")
    expect(html).toContain('target="_blank"')
    // An external target without noopener hands the new tab a window.opener
    // reference back into this site.
    expect(html).toContain('rel="noopener"')
  })

  it("falls back to the site name when there is no logo", () => {
    const html = renderToStaticMarkup(
      <theme.Layout settings={NO_SETTINGS} brand={{ ...BRAND, logoUrl: null }} nav={EMPTY_NAV}>
        <p>Body</p>
      </theme.Layout>,
    )
    expect(html).not.toContain("<img")
    expect(html).toContain("Example Site")
  })

  it("renders a slot the theme never declared without throwing", () => {
    const html = renderToStaticMarkup(
      <theme.Layout settings={NO_SETTINGS} brand={BRAND} nav={{ slots: { sidebar: [] } }}>
        <p>Body</p>
      </theme.Layout>,
    )
    expect(html).toContain("Body")
  })
})

describe("Home", () => {
  const Home = surface("Home")

  it("renders the brand and the core-built JSON-LD", () => {
    const html = renderToStaticMarkup(<Home settings={NO_SETTINGS} {...HOME_VIEW} />)
    expect(html).toContain("Example Site")
    expect(html).toContain("Words about things")
    expect(html).toContain('type="application/ld+json"')
  })

  it("emits no JSON-LD script at all when no business profile is configured", () => {
    // Not an empty node: a LocalBusiness without a name is invalid structured
    // data, and a crawler that reads it learns something false about the site.
    const html = renderToStaticMarkup(<Home settings={NO_SETTINGS} {...HOME_VIEW} jsonLd={null} />)
    expect(html).not.toContain("application/ld+json")
  })

  it("renders with no tagline", () => {
    const html = renderToStaticMarkup(<Home settings={NO_SETTINGS} brand={{ ...BRAND, tagline: null }} jsonLd={null} />)
    expect(html).toContain("Example Site")
  })
})

describe("Page", () => {
  const Page = surface("Page")

  it("renders the title, the sanitised body, and the JSON-LD", () => {
    const html = renderToStaticMarkup(<Page settings={NO_SETTINGS} {...PAGE_VIEW} />)
    expect(html).toContain("About Us")
    expect(html).toContain("Who we are.")
    expect(html).toContain('type="application/ld+json"')
  })

  it("escapes a hostile title inside the JSON-LD script", () => {
    // The exact bug this contract exists to prevent. The title is editor-set,
    // and a raw JSON.stringify once let a title containing a closing script tag
    // end the element early and execute on every visit. Core's JsonLd escapes
    // it, and a theme cannot opt out because a theme cannot build the graph.
    const html = renderToStaticMarkup(
      <Page settings={NO_SETTINGS} {...PAGE_VIEW} jsonLd={{ "@type": "WebPage", name: "</scr" + "ipt><script>alert(1)" }} />,
    )
    expect(html).not.toContain("<script>alert(1)")
    expect(html).toContain("\\u003c")
  })

  it("renders a page with an empty body", () => {
    const html = renderToStaticMarkup(<Page settings={NO_SETTINGS} {...PAGE_VIEW} html="" />)
    expect(html).toContain("About Us")
  })
})

describe("BlogIndex", () => {
  const BlogIndex = surface("BlogIndex")

  it("renders each post", () => {
    const html = renderToStaticMarkup(<BlogIndex settings={NO_SETTINGS} {...BLOG_INDEX_VIEW} />)
    expect(html).toContain("A Post About Everything")
    expect(html).toContain('type="application/ld+json"')
  })

  it("says so when nothing is published yet", () => {
    const html = renderToStaticMarkup(<BlogIndex settings={NO_SETTINGS} {...BLOG_INDEX_VIEW} posts={[]} totalPages={0} />)
    expect(html).toContain("No posts published yet")
  })

  it("carries no standing subtitle describing somebody else's subject matter", () => {
    const html = renderToStaticMarkup(<BlogIndex settings={NO_SETTINGS} {...BLOG_INDEX_VIEW} />)
    expect(html).not.toMatch(/locks, keys/i)
  })
})

describe("CategoryArchive and TagArchive", () => {
  const CategoryArchive = surface("CategoryArchive")
  const TagArchive = surface("TagArchive")

  it("renders a category archive", () => {
    const html = renderToStaticMarkup(<CategoryArchive settings={NO_SETTINGS} {...ARCHIVE_VIEW} />)
    expect(html).toContain("Guides")
    expect(html).toContain("Category")
    expect(html).toContain("Intro copy for page one.")
  })

  it("renders a tag archive from the same component", () => {
    const html = renderToStaticMarkup(<TagArchive settings={NO_SETTINGS} {...ARCHIVE_VIEW} kind="tag" />)
    expect(html).toContain("Tag")
    expect(html).toContain("/blog/tag/guides")
  })

  it("drops the intro on paginated pages", () => {
    // Repeating it would make every page after the first mostly-duplicate copy
    // of page one, which is what per-page titles exist to avoid.
    const html = renderToStaticMarkup(<CategoryArchive settings={NO_SETTINGS} {...ARCHIVE_VIEW} page={2} />)
    expect(html).not.toContain("Intro copy for page one.")
  })

  it("renders an empty archive", () => {
    const html = renderToStaticMarkup(<CategoryArchive settings={NO_SETTINGS} {...ARCHIVE_VIEW} posts={[]} totalPages={0} />)
    expect(html).toContain("No posts in this category yet")
  })

  it("renders a taxonomy with no description or intro", () => {
    const html = renderToStaticMarkup(
      <CategoryArchive settings={NO_SETTINGS}
        {...ARCHIVE_VIEW}
        taxonomy={{ ...ARCHIVE_VIEW.taxonomy, description: null, archiveIntro: null }}
      />,
    )
    expect(html).toContain("Guides")
  })
})

describe("AuthorArchive", () => {
  const AuthorArchive = surface("AuthorArchive")

  it("renders the author and their credentials", () => {
    const html = renderToStaticMarkup(<AuthorArchive settings={NO_SETTINGS} {...AUTHOR_ARCHIVE_VIEW} />)
    expect(html).toContain("Ada Lovelace")
    // Credentials are the E-E-A-T payload — a visible licence line is the
    // difference between a byline and a verifiable one.
    expect(html).toContain("MSc")
    expect(html).toContain("example.test")
  })

  it("marks off-site profile links nofollow and noopener", () => {
    const html = renderToStaticMarkup(<AuthorArchive settings={NO_SETTINGS} {...AUTHOR_ARCHIVE_VIEW} />)
    expect(html).toContain('rel="nofollow noopener me"')
  })

  it("renders an author with no avatar, bio, credentials or profiles", () => {
    const html = renderToStaticMarkup(
      <AuthorArchive settings={NO_SETTINGS}
        {...AUTHOR_ARCHIVE_VIEW}
        author={{
          ...AUTHOR_ARCHIVE_VIEW.author,
          avatarUrl: null,
          bio: null,
          credentials: null,
          jobTitle: null,
          sameAs: [],
        }}
        posts={[]}
      />,
    )
    expect(html).toContain("Ada Lovelace")
    expect(html).toContain("No posts by this author yet")
    expect(html).not.toContain("<img")
  })
})

describe("BlogPost", () => {
  const BlogPost = surface("BlogPost")

  it("renders the article, its TOC, and its structured-data-backed sections", () => {
    const html = renderToStaticMarkup(<BlogPost settings={NO_SETTINGS} {...BLOG_POST_VIEW} />)
    expect(html).toContain("A Post About Everything")
    expect(html).toContain("Body copy.")
    expect(html).toContain("Step by step")
    expect(html).toContain("Frequently asked questions")
    expect(html).toContain("Is it portable?")
  })

  it("renders every block the JSON-LD asserts exists", () => {
    // Google treats structured data describing content a visitor cannot see as
    // a manual-action risk, so the HowTo steps, the review rating, the video
    // and the reader questions all have to be on the page — not just in markup.
    const html = renderToStaticMarkup(<BlogPost settings={NO_SETTINGS} {...BLOG_POST_VIEW} />)
    expect(html).toContain("Do the first thing.")
    expect(html).toContain("Rated 4.5 out of 5")
    expect(html).toContain("https://example.test/video.mp4")
    expect(html).toContain("Does it work?")
  })

  it("anchors each HowTo step at the id its JSON-LD step url points to", () => {
    const html = renderToStaticMarkup(<BlogPost settings={NO_SETTINGS} {...BLOG_POST_VIEW} />)
    expect(html).toContain('id="howto-step-1"')
    expect(html).toContain('id="howto-step-2"')
  })

  it("renders a bare post: no TOC, series, HowTo, review, video, FAQ or questions", () => {
    const html = renderToStaticMarkup(
      <BlogPost settings={NO_SETTINGS}
        {...BLOG_POST_VIEW}
        post={{ ...BLOG_POST_VIEW.post, faqs: [], tags: [], series: null, seriesId: null }}
        questions={[]}
        related={[]}
        seriesPosts={[]}
        toc={{ html: "<p>Body copy.</p>", headings: [], hasToc: false }}
        howTo={null}
        review={null}
        video={null}
      />,
    )
    expect(html).toContain("A Post About Everything")
    expect(html).toContain("Body copy.")
    expect(html).not.toContain("Step by step")
    expect(html).not.toContain("Frequently asked questions")
  })

  it("omits the author card for the admin-account fallback byline", () => {
    // An empty card reads worse than none: the fallback has no credentials
    // worth showing.
    const html = renderToStaticMarkup(
      <BlogPost settings={NO_SETTINGS}
        {...BLOG_POST_VIEW}
        post={{
          ...BLOG_POST_VIEW.post,
          author: { ...BLOG_POST_VIEW.post.author, isRealAuthor: false, bio: null, credentials: null },
        }}
      />,
    )
    expect(html).not.toContain("MSc")
  })
})

describe("NotFound", () => {
  const NotFound = surface("NotFound")

  it("renders the 404 and names the site, not the software", () => {
    const html = renderToStaticMarkup(<NotFound settings={NO_SETTINGS} {...NOT_FOUND_VIEW} />)
    expect(html).toContain("404")
    expect(html).toContain("Page not found")
    expect(html).toContain("Example Site")
    expect(html).not.toContain("FlowCMS")
  })

  it("offers a way back rather than leaving the back button as the only exit", () => {
    const html = renderToStaticMarkup(<NotFound settings={NO_SETTINGS} {...NOT_FOUND_VIEW} />)
    expect(html).toContain('href="/"')
  })
})
