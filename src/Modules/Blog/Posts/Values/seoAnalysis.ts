import {
  countWords,
  extractHeadingsFlat,
  extractImages,
  extractLinks,
  slugifyText,
  stripHtml,
} from "./contentStats"

/**
 * The SEO checklist, as one pure function over plain data.
 *
 * The live editor panel calls this in the browser on every keystroke; the audit
 * dashboard calls the identical function on the server across every post, and
 * the write path stores its `score` on `blogPosts.seoScore`. So: no DOM, no DB,
 * no `next/*`, no dependencies. A score that differs between the panel and the
 * dashboard is a bug report nobody can act on.
 *
 * Nothing here blocks a save. Every rule below has a legitimate exception, and
 * an editor writing about an emergency callout should never be stopped by a
 * keyword-density gauge.
 */

export interface SeoCheck {
  id: string
  label: string
  status: "pass" | "warn" | "fail" | "na"
  /** What to DO about it. "Meta description is 43 characters" tells an editor
   *  nothing they can act on; "Expand it to at least 120" does. */
  detail: string
  weight: number
}

export interface SeoAnalysisInput {
  title: string
  slug: string
  excerpt: string
  metaTitle?: string | null
  metaDescription?: string | null
  content: string
  focusKeyword?: string | null
  /** Accepted but not scored: the spec's check table grades the focus keyword
   *  only. They are part of the input so the panel and the audit dashboard
   *  build the same object from the same row, rather than each assembling a
   *  different subset and drifting apart. */
  secondaryKeywords?: string[]
  /** `undefined` means the post has no featured image (check goes `na`);
   *  `null` or `""` means it has one with no alt (check fails). */
  featuredImageAltText?: string | null
  categoryNames?: string[]
  tagNames?: string[]
  /** `undefined` when the caller could not load FAQs — scored `na`, not zero.
   *  A list view that skips the FAQ join must not invent a warning. */
  faqCount?: number
  isIndexable?: boolean
  /** Origin used to classify links. Without it, only root-relative and
   *  scheme-less hrefs count as internal. */
  baseUrl?: string
}

export interface SeoAnalysis {
  score: number
  checks: SeoCheck[]
}

const STATUS_VALUE: Record<SeoCheck["status"], number> = { pass: 1, warn: 0.5, fail: 0, na: 0 }

/**
 * `na` is excluded from the denominator, never scored as zero.
 *
 * This is the single most important line in the file. A brand-new post with no
 * focus keyword yet would otherwise open at 12/100, and a panel that shows red
 * for correct work is a panel editors learn to ignore within a week.
 *
 * Exported so `readability.ts` scores its own checks with the same formula —
 * two rounding rules would make the two tabs disagree about what 70 means.
 */
export function scoreChecks(checks: SeoCheck[]): number {
  const scored = checks.filter((check) => check.status !== "na")
  const denominator = scored.reduce((sum, check) => sum + check.weight, 0)
  if (denominator === 0) return 0
  const numerator = scored.reduce((sum, check) => sum + check.weight * STATUS_VALUE[check.status], 0)
  return Math.round((100 * numerator) / denominator)
}

const WORD_BOUNDARY = /[a-z0-9À-ɏ]/i

/** Whole-phrase, case-insensitive occurrence count. Boundary-checked, because
 *  a substring count lets "key" score three hits off one "keyboard" and pushes
 *  a normal post over the 2.5 % over-optimisation line. */
function countOccurrences(haystack: string, phrase: string): number {
  const needle = phrase.trim().toLowerCase()
  if (!needle) return 0
  const text = haystack.toLowerCase()
  let count = 0
  let index = text.indexOf(needle)
  while (index !== -1) {
    const before = index === 0 ? "" : text.charAt(index - 1)
    const after = text.charAt(index + needle.length)
    if (!WORD_BOUNDARY.test(before) && !WORD_BOUNDARY.test(after)) count += 1
    index = text.indexOf(needle, index + 1)
  }
  return count
}

function contains(haystack: string | null | undefined, phrase: string): boolean {
  return !!haystack && countOccurrences(haystack, phrase) > 0
}

/**
 * A link is internal when it is site-relative or shares an origin with
 * `baseUrl`. Protocol-relative and absolute URLs on other hosts are external;
 * fragments and `mailto:`/`tel:` are neither and are dropped by the caller.
 */
function isInternalHref(href: string, baseUrl: string | undefined): boolean {
  if (href.startsWith("/")) return !href.startsWith("//")
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) return true // "about", "./guide"
  if (!baseUrl) return false
  const origin = baseUrl.replace(/^([a-z]+:\/\/[^/]+).*$/i, "$1").toLowerCase()
  return !!origin && href.toLowerCase().startsWith(origin)
}

function check(
  id: string,
  label: string,
  weight: number,
  status: SeoCheck["status"],
  detail: string
): SeoCheck {
  return { id, label, status, detail, weight }
}

export function analyseSeo(input: SeoAnalysisInput): SeoAnalysis {
  const checks: SeoCheck[] = []

  const keyword = (input.focusKeyword ?? "").trim()
  const hasKeyword = keyword.length > 0

  // The same fallback chain `buildPostMetadata` emits. Judging the raw
  // `metaTitle` would score a blank field as broken when the page actually
  // ships a perfectly good title from `title`.
  const seoTitle = (input.metaTitle ?? "").trim() || input.title.trim()
  const seoDescription = (input.metaDescription ?? "").trim() || input.excerpt.trim()

  const plainContent = stripHtml(input.content)
  const wordCount = countWords(input.content)
  const headings = extractHeadingsFlat(input.content)
  const images = extractImages(input.content)
  const links = extractLinks(input.content)
  const featuredAlt = input.featuredImageAltText

  // -- Keyword checks -------------------------------------------------------
  // All eight go `na` together when no focus keyword is set. They are the only
  // checks in the table that cannot be evaluated without one, and scoring them
  // zero would punish a post for a field the editor has not reached yet.

  checks.push(
    hasKeyword
      ? check("focus-keyword", "Focus keyword set", 10, "pass", `Analysing against "${keyword}".`)
      : check(
          "focus-keyword",
          "Focus keyword set",
          10,
          // `warn`, not `na`, and deliberately the one keyword check that
          // still scores. If this were `na` too, a post with no focus keyword
          // would have nothing anywhere in its score suggesting it wants one —
          // the panel would look complete while the single most useful field
          // sat empty. A warn nudges without the 12/100 that teaches editors
          // to ignore the panel; the other eight stay `na`.
          "warn",
          "Set a focus keyword to turn on the eight keyword checks. They are not counted against the score until you do."
        )
  )

  if (!hasKeyword) {
    const dormant = "Needs a focus keyword before this can be checked."
    checks.push(
      check("keyword-in-title", "Keyword in SEO title", 9, "na", dormant),
      check("keyword-in-slug", "Keyword in slug", 7, "na", dormant),
      check("keyword-in-meta-description", "Keyword in meta description", 7, "na", dormant),
      check("keyword-in-intro", "Keyword in the opening", 8, "na", dormant),
      check("keyword-in-subheading", "Keyword in a subheading", 6, "na", dormant),
      check("keyword-in-image-alt", "Keyword in an image alt", 5, "na", dormant),
      check("keyword-density", "Keyword density", 6, "na", dormant)
    )
  } else {
    checks.push(
      contains(seoTitle, keyword)
        ? check("keyword-in-title", "Keyword in SEO title", 9, "pass", "The SEO title contains the focus keyword.")
        : check(
            "keyword-in-title",
            "Keyword in SEO title",
            9,
            "fail",
            `Work "${keyword}" into the SEO title, ideally near the start.`
          )
    )

    const keywordSlug = slugifyText(keyword)
    checks.push(
      keywordSlug && input.slug.includes(keywordSlug)
        ? check("keyword-in-slug", "Keyword in slug", 7, "pass", "The slug contains the focus keyword.")
        : check(
            "keyword-in-slug",
            "Keyword in slug",
            7,
            "fail",
            `Put "${keywordSlug || keyword}" in the slug — but only before the post is published, since changing it later costs a redirect.`
          )
    )

    checks.push(
      contains(seoDescription, keyword)
        ? check(
            "keyword-in-meta-description",
            "Keyword in meta description",
            7,
            "pass",
            "The meta description contains the focus keyword."
          )
        : check(
            "keyword-in-meta-description",
            "Keyword in meta description",
            7,
            "fail",
            `Add "${keyword}" to the meta description — Google bolds it in the result, which lifts click-through.`
          )
    )

    // 10 % of the body, floored at 100 characters so a short post is not judged
    // on its first sentence fragment.
    const intro = plainContent.slice(0, Math.max(100, Math.ceil(plainContent.length * 0.1)))
    checks.push(
      contains(intro, keyword)
        ? check("keyword-in-intro", "Keyword in the opening", 8, "pass", "The focus keyword appears in the opening.")
        : check(
            "keyword-in-intro",
            "Keyword in the opening",
            8,
            "fail",
            `Mention "${keyword}" in the first paragraph so the reader and the crawler both see the topic immediately.`
          )
    )

    const subheadings = headings.filter((heading) => heading.level >= 2 && heading.level <= 4)
    checks.push(
      subheadings.some((heading) => contains(heading.text, keyword))
        ? check("keyword-in-subheading", "Keyword in a subheading", 6, "pass", "A subheading contains the focus keyword.")
        : check(
            "keyword-in-subheading",
            "Keyword in a subheading",
            6,
            "fail",
            subheadings.length === 0
              ? `Break the post up with H2 subheadings and use "${keyword}" in one of them.`
              : `Rework one H2–H4 subheading to include "${keyword}".`
          )
    )

    const altTexts = [featuredAlt ?? "", ...images.map((image) => image.alt ?? "")]
    checks.push(
      altTexts.some((alt) => contains(alt, keyword))
        ? check("keyword-in-image-alt", "Keyword in an image alt", 5, "pass", "An image alt contains the focus keyword.")
        : check(
            "keyword-in-image-alt",
            "Keyword in an image alt",
            5,
            "fail",
            `Describe one image with alt text that includes "${keyword}" — naturally; alt text is read aloud before it is crawled.`
          )
    )

    if (wordCount === 0) {
      checks.push(check("keyword-density", "Keyword density", 6, "na", "Density needs body content to measure."))
    } else {
      const density = (countOccurrences(plainContent, keyword) / wordCount) * 100
      const shown = density.toFixed(1)
      checks.push(
        density > 2.5
          ? check(
              "keyword-density",
              "Keyword density",
              6,
              "fail",
              `${shown} % is over-optimised. Replace some instances of "${keyword}" with pronouns or synonyms — repetition past ~2.5 % is a penalty, not a signal.`
            )
          : density < 0.5
            ? check(
                "keyword-density",
                "Keyword density",
                6,
                "warn",
                `${shown} % is thin. Use "${keyword}" a few more times where it reads naturally — but a low-density post is usually just a well-written one.`
              )
            : check("keyword-density", "Keyword density", 6, "pass", `${shown} %, inside the 0.5–2.5 % range.`)
      )
    }
  }

  // -- Metadata length ------------------------------------------------------
  // Character counts are a proxy; the SERP preview measures pixels. These stay
  // because the audit dashboard has no canvas to measure with.

  const titleLength = seoTitle.length
  checks.push(
    titleLength >= 30 && titleLength <= 60
      ? check("title-length", "SEO title length", 8, "pass", `${titleLength} characters, inside 30–60.`)
      : titleLength >= 20 && titleLength < 30
        ? check("title-length", "SEO title length", 8, "warn", `${titleLength} characters. Add detail to reach 30–60 — short titles waste result space.`)
        : titleLength > 60 && titleLength <= 70
          ? check("title-length", "SEO title length", 8, "warn", `${titleLength} characters. Trim towards 60 or Google will truncate the tail.`)
          : check(
              "title-length",
              "SEO title length",
              8,
              "fail",
              titleLength === 0
                ? "Give the post a title."
                : `${titleLength} characters. Rewrite to 30–60 so the whole title survives the result page.`
            )
  )

  const descriptionLength = seoDescription.length
  checks.push(
    descriptionLength >= 120 && descriptionLength <= 160
      ? check("meta-description-length", "Meta description length", 8, "pass", `${descriptionLength} characters, inside 120–160.`)
      : descriptionLength >= 100 && descriptionLength < 120
        ? check("meta-description-length", "Meta description length", 8, "warn", `${descriptionLength} characters. Expand to at least 120 — you are giving away free result space.`)
        : descriptionLength > 160 && descriptionLength <= 170
          ? check("meta-description-length", "Meta description length", 8, "warn", `${descriptionLength} characters. Trim to 160 so the call to action is not the part that gets cut.`)
          : check(
              "meta-description-length",
              "Meta description length",
              8,
              "fail",
              descriptionLength === 0
                ? "Write a meta description, or an excerpt for it to fall back to."
                : `${descriptionLength} characters. Rewrite to 120–160.`
            )
  )

  // -- Structure ------------------------------------------------------------

  const bodyH1Count = headings.filter((heading) => heading.level === 1).length
  checks.push(
    bodyH1Count === 0
      ? check("single-h1", "Exactly one H1 on the page", 6, "pass", "The body has no H1, so the post title is the only one.")
      : check(
          "single-h1",
          "Exactly one H1 on the page",
          6,
          "fail",
          `The body contains ${bodyH1Count} H1${bodyH1Count === 1 ? "" : "s"}. Demote them to H2 — the page template already renders the title as the H1.`
        )
  )

  const bodyHeadings = headings.filter((heading) => heading.level >= 2)
  const firstH2Index = bodyHeadings.findIndex((heading) => heading.level === 2)
  const h3BeforeH2 = bodyHeadings.some(
    (heading, index) => heading.level === 3 && (firstH2Index === -1 || index < firstH2Index)
  )
  const hasLevelJump = bodyHeadings.some(
    (heading, index) => index > 0 && heading.level > bodyHeadings[index - 1].level + 1
  )
  checks.push(
    h3BeforeH2
      ? check(
          "heading-order",
          "Heading order",
          4,
          "fail",
          "An H3 appears before any H2. Promote it, or add the H2 section it belongs under."
        )
      : hasLevelJump
        ? check("heading-order", "Heading order", 4, "warn", "A heading level is skipped. Step down one level at a time so the outline stays readable.")
        : check("heading-order", "Heading order", 4, "pass", "Headings descend one level at a time.")
  )

  checks.push(
    wordCount >= 600
      ? check("content-length", "Content length", 8, "pass", `${wordCount} words.`)
      : wordCount >= 300
        ? check("content-length", "Content length", 8, "warn", `${wordCount} words. Aim for 600 — add the detail a reader would otherwise search again for.`)
        : check("content-length", "Content length", 8, "fail", `${wordCount} words is thin. Get past 300 before publishing, and 600 to compete.`)
  )

  // -- Links ----------------------------------------------------------------

  const pageLinks = links.filter((link) => !/^(#|mailto:|tel:)/i.test(link.href))
  const internalLinks = pageLinks.filter((link) => isInternalHref(link.href, input.baseUrl))
  const externalLinks = pageLinks.filter((link) => !isInternalHref(link.href, input.baseUrl))

  checks.push(
    internalLinks.length > 0
      ? check("internal-links", "Internal links", 7, "pass", `${internalLinks.length} internal link${internalLinks.length === 1 ? "" : "s"}.`)
      : check(
          "internal-links",
          "Internal links",
          7,
          "fail",
          "Link to at least one other post on the site. A post with no outbound internal links is a dead end for readers and for crawl depth alike."
        )
  )

  checks.push(
    externalLinks.length > 0
      ? check("external-links", "External links", 3, "pass", `${externalLinks.length} external link${externalLinks.length === 1 ? "" : "s"}.`)
      : check(
          "external-links",
          "External links",
          3,
          "warn",
          "Cite a source or a standard where one applies. Optional — plenty of good posts have nothing worth linking out to."
        )
  )

  // -- Images ---------------------------------------------------------------

  const missingAlt = images.filter((image) => !(image.alt ?? "").trim()).length
  checks.push(
    images.length === 0
      ? check("image-alt", "In-content images have alt text", 7, "na", "No images in the body.")
      : missingAlt === 0
        ? check("image-alt", "In-content images have alt text", 7, "pass", `All ${images.length} image${images.length === 1 ? " has" : "s have"} alt text.`)
        : check(
            "image-alt",
            "In-content images have alt text",
            7,
            "fail",
            `${missingAlt} image${missingAlt === 1 ? "" : "s"} without alt text. Describe what each one shows — this is an accessibility requirement first and an image-search entry second.`
          )
  )

  checks.push(
    featuredAlt === undefined
      ? check("featured-image-alt", "Featured image alt text", 5, "na", "No featured image on this post.")
      : (featuredAlt ?? "").trim()
        ? check("featured-image-alt", "Featured image alt text", 5, "pass", "The featured image has alt text.")
        : check(
            "featured-image-alt",
            "Featured image alt text",
            5,
            "fail",
            "Describe the featured image. It is the one that shows up in image search and in the social card."
          )
  )

  // -- Slug, FAQs, indexing -------------------------------------------------

  const slugWords = input.slug.split("-").filter(Boolean).length
  checks.push(
    input.slug.length === 0
      ? check("slug-length", "Slug length", 3, "fail", "Give the post a slug.")
      : input.slug.length <= 75 && slugWords <= 6
        ? check("slug-length", "Slug length", 3, "pass", `${input.slug.length} characters, ${slugWords} word${slugWords === 1 ? "" : "s"}.`)
        : input.slug.length <= 90 && slugWords <= 8
          ? check("slug-length", "Slug length", 3, "warn", `${slugWords} words. Drop the filler words — the slug is a label, not a summary.`)
          : check("slug-length", "Slug length", 3, "fail", `${input.slug.length} characters over ${slugWords} words. Cut it to 6 words or fewer.`)
  )

  checks.push(
    input.faqCount === undefined
      ? check("faq", "At least one FAQ", 3, "na", "FAQ data was not supplied to the analyser.")
      : input.faqCount > 0
        ? check("faq", "At least one FAQ", 3, "pass", `${input.faqCount} FAQ${input.faqCount === 1 ? "" : "s"} feed the FAQPage markup.`)
        : check(
            "faq",
            "At least one FAQ",
            3,
            "warn",
            "Add the question a caller actually asks about this. It renders on the page and feeds the FAQPage markup."
          )
  )

  checks.push(
    input.isIndexable === false
      ? check(
          "indexable",
          "Post is indexable",
          2,
          "fail",
          "This post is set to noindex, so none of the above reaches search. Turn indexing on unless you are hiding it deliberately."
        )
      : check("indexable", "Post is indexable", 2, "pass", "Search engines are allowed to index this post.")
  )

  return { score: scoreChecks(checks), checks }
}
