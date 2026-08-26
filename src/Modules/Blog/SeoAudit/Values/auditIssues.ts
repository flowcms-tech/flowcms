import { analyseSeo, type SeoCheck } from '@/Modules/Blog/Posts/Values/seoAnalysis'
import { analyseReadability } from '@/Modules/Blog/Posts/Values/readability'
import { countWords, extractLinks } from '@/Modules/Blog/Posts/Values/contentStats'
import { internalPostSlug, toInternalPath } from '@/Modules/Blog/Posts/Values/internalUrls'
import type {
  AuditIssueGroup,
  AuditPostSummary,
  AuditSeverity,
  SeoAuditReport,
} from '../Types'

/**
 * The SEO audit, as one pure function over plain post records.
 *
 * **Analyser parity is the contract.** Every rule that already exists as a
 * check in `analyseSeo` is read back OUT of that check's result here — the
 * length bands, the alt-text rules, the thin-content threshold, the
 * internal-link rule. None of them are re-expressed as a second `if`. That is
 * why the score on this dashboard and the score in the editor panel are the
 * same number for the same post: they are the same computation, not two
 * computations that agree today.
 *
 * The rules that ARE written here are the ones the per-post analyser cannot
 * see, because they need every other post: duplicates, orphans, inbound link
 * counts, staleness against a calendar.
 */

export interface AuditPostInput {
  id: string
  title: string
  slug: string
  excerpt: string
  content: string
  metaTitle: string | null
  metaDescription: string | null
  canonicalUrl: string | null
  focusKeyword: string | null
  secondaryKeywords: string[]
  featuredImageAltText: string | null
  categoryNames: string[]
  tagNames: string[]
  faqCount: number
  isIndexable: boolean
  isPublished: boolean
  isCornerstone: boolean
  /** ISO strings, or null. */
  publishedAt: string | null
  contentUpdatedAt: string | null
  updatedAt: string
}

export interface AuditBrokenLink {
  postId: string
  url: string
  result: string
  statusCode: number | null
}

export interface BuildSeoAuditInput {
  posts: AuditPostInput[]
  baseUrl: string
  /** Rows from the last link scan whose result was `broken`. Empty when no scan
   *  has run — which the UI distinguishes from "no broken links found". */
  brokenLinks: AuditBrokenLink[]
  lastLinkScanAt: string | null
  unverifiableLinkCount: number
}

/** Published this long ago with no substantive update since. 18 months is the
 *  spec's line: long enough that a still-accurate evergreen post is not
 *  nagged every quarter. */
const STALE_AFTER_MS = 18 * 30 * 24 * 60 * 60 * 1000

/** `contentUpdatedAt` within a day of `publishedAt` is the publish itself, not
 *  a later revision. */
const UPDATE_GRACE_MS = 24 * 60 * 60 * 1000

/** Cornerstone posts are pillar pages; under this many inbound internal links
 *  the cluster around them does not exist. */
const CORNERSTONE_MIN_INBOUND = 3

/** Slug token overlap at or above this reads as the same page twice. */
const NEAR_DUPLICATE_SLUG_RATIO = 0.75

const RECENTLY_FIXED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function parseDate(value: string | null): number | null {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

function normaliseText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function slugTokens(slug: string): Set<string> {
  return new Set(slug.toLowerCase().split('-').filter(Boolean))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const token of a) if (b.has(token)) shared += 1
  return shared / (a.size + b.size - shared)
}

/** Trailing slashes and the scheme's default port differ between what an editor
 *  pastes and what the sitemap emits; neither is a different page. */
function normaliseUrl(value: string): string {
  return value.trim().toLowerCase().replace(/\/+$/, '')
}

class GroupBuilder {
  private readonly groups = new Map<string, AuditIssueGroup>()

  define(id: string, title: string, severity: AuditSeverity, description: string): void {
    this.groups.set(id, { id, title, severity, description, posts: [] })
  }

  add(id: string, post: AuditPostInput, detail: string): void {
    this.groups.get(id)?.posts.push({ postId: post.id, title: post.title, slug: post.slug, detail })
  }

  /** Empty groups are dropped rather than shown as "0 issues" — a screen of
   *  green zeroes buries the four things that actually need doing. */
  build(): AuditIssueGroup[] {
    return Array.from(this.groups.values()).filter((group) => group.posts.length > 0)
  }
}

function findCheck(checks: SeoCheck[], id: string): SeoCheck | undefined {
  return checks.find((check) => check.id === id)
}

export function buildSeoAudit(input: BuildSeoAuditInput): SeoAuditReport {
  const { posts, baseUrl } = input
  const now = Date.now()

  const builder = new GroupBuilder()
  builder.define(
    'meta-title-length',
    'Meta title length',
    'warning',
    'The title Google shows is outside 30–60 characters, so it either wastes result space or gets truncated mid-word.'
  )
  builder.define(
    'meta-title-missing',
    'No custom meta title',
    'info',
    'These posts fall back to their on-page title. That is not wrong, but the title is written for a reader already on the page, and a SERP title is written to earn the click.'
  )
  builder.define(
    'meta-description-length',
    'Meta description length',
    'warning',
    'Outside 120–160 characters. Too short gives away free result space; too long means the call to action is the part that gets cut.'
  )
  builder.define(
    'meta-description-missing',
    'No custom meta description',
    'info',
    'These posts fall back to their excerpt. The excerpt is a teaser on a card; a meta description is an ad in a list of ten.'
  )
  builder.define(
    'focus-keyword-missing',
    'No focus keyword',
    'warning',
    'Without a stated target, eight of the on-page checks cannot run at all — for these posts the editor panel is mostly blank.'
  )
  builder.define(
    'focus-keyword-duplicate',
    'Duplicate focus keyword',
    'critical',
    'Two or more posts target the same query, so they compete with each other and Google picks one more or less at random. Merge them, or retarget one.'
  )
  builder.define(
    'meta-title-duplicate',
    'Duplicate meta title',
    'critical',
    'Identical titles in the result list are indistinguishable to a searcher and read as thin, templated content to Google.'
  )
  builder.define(
    'meta-description-duplicate',
    'Duplicate meta description',
    'warning',
    'The same description on several results. Google usually rewrites the snippet in this case, which means losing control of it entirely.'
  )
  builder.define(
    'slug-near-duplicate',
    'Near-duplicate slugs',
    'warning',
    'Slugs this similar usually mean two posts covering the same ground. Decide which one is the answer and redirect the other into it.'
  )
  builder.define(
    'featured-image-alt',
    'Featured image has no alt text',
    'warning',
    'This is an accessibility requirement first and an image-search entry second. It is also the image in the social card.'
  )
  builder.define(
    'content-image-alt',
    'In-content images missing alt text',
    'warning',
    'Every image in the body needs a description of what it shows.'
  )
  builder.define(
    'thin-content',
    'Thin content',
    'critical',
    'Under 300 words. Not enough to answer anything properly, and the single strongest predictor of a page that never ranks.'
  )
  builder.define(
    'orphan-post',
    'Orphan posts',
    'critical',
    'No other post links to these. Readers can only reach them from an archive, and crawl priority follows internal links — an orphan is effectively invisible.'
  )
  builder.define(
    'no-outbound-internal-links',
    'No outbound internal links',
    'warning',
    'A post that links nowhere is a dead end for the reader and for crawl depth alike.'
  )
  builder.define(
    'stale-content',
    'Stale content',
    'warning',
    'Published over 18 months ago and never substantively updated. Reread it — prices, response times, and standards move. Only tick "substantive update" if you actually changed something.'
  )
  builder.define(
    'noindex-still-linked',
    'noindex posts linked from other posts',
    'warning',
    'These are hidden from search but still linked, so link equity flows into a page that cannot return it. Either index them or stop linking them.'
  )
  builder.define(
    'canonical-points-elsewhere',
    'In the sitemap but canonical points elsewhere',
    'critical',
    'The sitemap says "index this" and the canonical tag says "index that other page instead". Google resolves the contradiction by ignoring one of them, and you do not get to choose which.'
  )
  builder.define(
    'broken-links',
    'Broken links',
    'critical',
    'From the last scan. Only genuine 404s, 410s, and dead domains are listed here — anything a site merely refused to answer is reported as unverifiable instead, never as broken.'
  )
  builder.define(
    'cornerstone-low-inbound',
    'Cornerstone posts with few inbound links',
    'warning',
    `A pillar page with fewer than ${CORNERSTONE_MIN_INBOUND} inbound internal links is the most common content-cluster failure: the cluster was never actually built.`
  )

  // -- Per-post analysis, and the inbound-link graph -------------------------

  const bySlug = new Map(posts.map((post) => [post.slug.toLowerCase(), post]))
  const inboundCount = new Map<string, number>()
  const analyses = new Map<string, ReturnType<typeof analyseSeo>>()
  const summaries: AuditPostSummary[] = []

  for (const post of posts) {
    const analysis = analyseSeo({
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      metaTitle: post.metaTitle,
      metaDescription: post.metaDescription,
      content: post.content,
      focusKeyword: post.focusKeyword,
      secondaryKeywords: post.secondaryKeywords,
      // `featuredImageKey` is notNull on the table, so every post has one and
      // an empty alt is a fail rather than `na`. Matching the edit screen's
      // construction exactly is what keeps the two scores identical.
      featuredImageAltText: post.featuredImageAltText ?? '',
      categoryNames: post.categoryNames,
      tagNames: post.tagNames,
      faqCount: post.faqCount,
      isIndexable: post.isIndexable,
      baseUrl,
    })
    analyses.set(post.id, analysis)

    // Inbound links, counted per (source, target) pair: a post linking the same
    // target four times is one relationship, and counting it as four would let
    // a single enthusiastic post satisfy the cornerstone rule on its own.
    const targets = new Set<string>()
    for (const link of extractLinks(post.content)) {
      const slug = internalPostSlug(toInternalPath(link.href, baseUrl))
      if (!slug || slug === post.slug.toLowerCase()) continue
      if (!bySlug.has(slug)) continue
      targets.add(slug)
    }
    for (const target of targets) {
      inboundCount.set(target, (inboundCount.get(target) ?? 0) + 1)
    }
  }

  // -- Rules read back out of the shared analyser ---------------------------

  const CHECK_GROUPS: { checkId: string; groupId: string; statuses: SeoCheck['status'][] }[] = [
    { checkId: 'title-length', groupId: 'meta-title-length', statuses: ['fail', 'warn'] },
    { checkId: 'meta-description-length', groupId: 'meta-description-length', statuses: ['fail', 'warn'] },
    { checkId: 'focus-keyword', groupId: 'focus-keyword-missing', statuses: ['warn', 'fail'] },
    { checkId: 'featured-image-alt', groupId: 'featured-image-alt', statuses: ['fail'] },
    { checkId: 'image-alt', groupId: 'content-image-alt', statuses: ['fail'] },
    { checkId: 'content-length', groupId: 'thin-content', statuses: ['fail'] },
    { checkId: 'internal-links', groupId: 'no-outbound-internal-links', statuses: ['fail'] },
  ]

  for (const post of posts) {
    const analysis = analyses.get(post.id)
    if (!analysis) continue
    for (const mapping of CHECK_GROUPS) {
      const check = findCheck(analysis.checks, mapping.checkId)
      // The check's own `detail` is reused verbatim, so the dashboard tells an
      // editor exactly what the editor panel will tell them when they open the
      // post. Rewording it here is how the two screens start to disagree.
      if (check && mapping.statuses.includes(check.status)) {
        builder.add(mapping.groupId, post, check.detail)
      }
    }
  }

  // -- Cross-post rules ------------------------------------------------------

  const groupBy = (key: (post: AuditPostInput) => string) => {
    const map = new Map<string, AuditPostInput[]>()
    for (const post of posts) {
      const value = key(post)
      if (!value) continue
      const bucket = map.get(value)
      if (bucket) bucket.push(post)
      else map.set(value, [post])
    }
    return map
  }

  for (const [keyword, group] of groupBy((post) => normaliseText(post.focusKeyword))) {
    if (group.length < 2) continue
    for (const post of group) {
      builder.add(
        'focus-keyword-duplicate',
        post,
        `"${keyword}" is also the focus keyword on ${group.length - 1} other post${group.length === 2 ? '' : 's'}: ${group
          .filter((other) => other.id !== post.id)
          .map((other) => other.title)
          .join(', ')}.`
      )
    }
  }

  for (const [title, group] of groupBy((post) => normaliseText(post.metaTitle || post.title))) {
    if (group.length < 2) continue
    for (const post of group) {
      builder.add(
        'meta-title-duplicate',
        post,
        `The resolved SEO title "${title}" is shared with ${group.length - 1} other post${group.length === 2 ? '' : 's'}.`
      )
    }
  }

  for (const [, group] of groupBy((post) => normaliseText(post.metaDescription || post.excerpt))) {
    if (group.length < 2) continue
    for (const post of group) {
      builder.add(
        'meta-description-duplicate',
        post,
        `The resolved meta description is identical to ${group.length - 1} other post${group.length === 2 ? '' : 's'}.`
      )
    }
  }

  // O(n²) over slugs. Fine at blog scale, and the alternative (a shingle index)
  // is a lot of machinery for a list that is never going to reach four figures.
  const tokenSets = posts.map((post) => ({ post, tokens: slugTokens(post.slug) }))
  for (let i = 0; i < tokenSets.length; i += 1) {
    for (let j = i + 1; j < tokenSets.length; j += 1) {
      const ratio = jaccard(tokenSets[i].tokens, tokenSets[j].tokens)
      if (ratio < NEAR_DUPLICATE_SLUG_RATIO) continue
      builder.add(
        'slug-near-duplicate',
        tokenSets[i].post,
        `Nearly the same slug as "${tokenSets[j].post.slug}".`
      )
      builder.add(
        'slug-near-duplicate',
        tokenSets[j].post,
        `Nearly the same slug as "${tokenSets[i].post.slug}".`
      )
    }
  }

  for (const post of posts) {
    const inbound = inboundCount.get(post.slug.toLowerCase()) ?? 0

    if (!(post.metaTitle ?? '').trim()) {
      builder.add('meta-title-missing', post, 'Falls back to the on-page title.')
    }
    if (!(post.metaDescription ?? '').trim()) {
      builder.add('meta-description-missing', post, 'Falls back to the excerpt.')
    }

    // Only published posts can be orphans — an unpublished draft has no
    // inbound links because it is not on the site yet, which is not a problem.
    if (post.isPublished && inbound === 0) {
      builder.add('orphan-post', post, 'No other post links to it.')
    }

    if (post.isCornerstone && inbound < CORNERSTONE_MIN_INBOUND) {
      builder.add(
        'cornerstone-low-inbound',
        post,
        `${inbound} inbound internal link${inbound === 1 ? '' : 's'}. Link to it from the posts in its category that cover a piece of the same topic.`
      )
    }

    if (!post.isIndexable && inbound > 0) {
      builder.add(
        'noindex-still-linked',
        post,
        `Set to noindex but linked from ${inbound} other post${inbound === 1 ? '' : 's'}.`
      )
    }

    const publishedAt = parseDate(post.publishedAt)
    const contentUpdatedAt = parseDate(post.contentUpdatedAt)
    if (
      post.isPublished &&
      publishedAt !== null &&
      now - publishedAt > STALE_AFTER_MS &&
      (contentUpdatedAt === null || contentUpdatedAt - publishedAt < UPDATE_GRACE_MS)
    ) {
      const months = Math.floor((now - publishedAt) / (30 * 24 * 60 * 60 * 1000))
      builder.add('stale-content', post, `Published ${months} months ago, never substantively updated.`)
    }

    const canonical = (post.canonicalUrl ?? '').trim()
    if (post.isPublished && post.isIndexable && canonical) {
      const own = normaliseUrl(`${baseUrl}/blog/${post.slug}`)
      if (normaliseUrl(canonical) !== own) {
        builder.add(
          'canonical-points-elsewhere',
          post,
          `In the sitemap, but its canonical URL is ${canonical}.`
        )
      }
    }
  }

  const postById = new Map(posts.map((post) => [post.id, post]))
  const brokenByPost = new Map<string, AuditBrokenLink[]>()
  for (const link of input.brokenLinks) {
    const bucket = brokenByPost.get(link.postId)
    if (bucket) bucket.push(link)
    else brokenByPost.set(link.postId, [link])
  }
  for (const [postId, links] of brokenByPost) {
    const post = postById.get(postId)
    if (!post) continue
    builder.add(
      'broken-links',
      post,
      `${links.length} broken link${links.length === 1 ? '' : 's'}: ${links
        .slice(0, 3)
        .map((link) => link.url)
        .join(', ')}${links.length > 3 ? ` and ${links.length - 3} more` : ''}.`
    )
  }

  // -- Tiles -----------------------------------------------------------------

  const groups = builder.build()

  const issueCountByPost = new Map<string, number>()
  for (const group of groups) {
    for (const entry of group.posts) {
      issueCountByPost.set(entry.postId, (issueCountByPost.get(entry.postId) ?? 0) + 1)
    }
  }

  for (const post of posts) {
    const analysis = analyses.get(post.id)
    summaries.push({
      postId: post.id,
      title: post.title,
      slug: post.slug,
      seoScore: analysis?.score ?? 0,
      readabilityScore: analyseReadability(post.content).score,
      wordCount: countWords(post.content),
      isPublished: post.isPublished,
      isIndexable: post.isIndexable,
      issueCount: issueCountByPost.get(post.id) ?? 0,
    })
  }

  const totalIssues = groups.reduce((sum, group) => sum + group.posts.length, 0)
  const averageSeoScore =
    summaries.length === 0
      ? 0
      : Math.round(summaries.reduce((sum, row) => sum + row.seoScore, 0) / summaries.length)

  const recentlyFixed = posts.filter((post) => {
    const updatedAt = parseDate(post.updatedAt)
    if (updatedAt === null || now - updatedAt > RECENTLY_FIXED_WINDOW_MS) return false
    return (issueCountByPost.get(post.id) ?? 0) === 0
  }).length

  return {
    generatedAt: new Date(now).toISOString(),
    tiles: {
      averageSeoScore,
      postsBelowFifty: summaries.filter((row) => row.seoScore < 50).length,
      totalIssues,
      recentlyFixed,
    },
    groups,
    posts: summaries.sort((a, b) => a.seoScore - b.seoScore),
    linkScan: {
      lastScannedAt: input.lastLinkScanAt,
      broken: input.brokenLinks.length,
      unverifiable: input.unverifiableLinkCount,
    },
  }
}
