export interface BlogPostCategoryRef {
  id: string
  name: string
}

export interface BlogPostTagRef {
  id: string
  name: string
}

export interface BlogPostAuthorRef {
  id: string
  name: string
}

export interface BlogPost extends Record<string, unknown> {
  id: string
  title: string
  slug: string
  excerpt: string
  content: string
  featuredImageKey: string
  featuredImageUrl: string
  featuredImageAltText: string | null
  /** The admin account that created the post — audit trail, not the byline. */
  createdBy: BlogPostAuthorRef
  authorProfileId: string | null
  /** The public byline. Null on posts created before the Authors module. */
  author: { id: string; name: string; jobTitle: string | null } | null
  isPublished: boolean
  publishedAt: string | null
  scheduledPublishAt: string | null
  metaTitle: string | null
  metaDescription: string | null
  canonicalUrl: string | null
  ogImageKey: string | null
  isIndexable: boolean
  /** Non-null means the post is in the trash. */
  deletedAt: string | null
  /** Set while another admin has this post's edit page open. Null once
   *  their session has been idle past the lock timeout. */
  lockedBy: { id: string; name: string } | null
  lockedAt: string | null
  /** Set when this post's own /blog/<slug> path has a redirect pointed away
   *  from it. Informational — see src/db/redirectMaintenance.ts. */
  redirectTo: string | null
  categories: BlogPostCategoryRef[]
  tags: BlogPostTagRef[]

  // -- Focus keyword and analysis --------------------------------------------
  focusKeyword: string | null
  secondaryKeywords: string[]
  /** Last computed on write. The panel and the audit screen both re-run the
   *  analyser rather than trusting this — it exists so the list can sort. */
  seoScore: number | null
  readabilityScore: number | null

  // -- Content structure ------------------------------------------------------
  wordCount: number | null
  /** Only ever set by an explicit "substantive update" — never `updatedAt`. */
  contentUpdatedAt: string | null
  isCornerstone: boolean
  seriesId: string | null
  series: { id: string; name: string } | null
  seriesPosition: number | null

  // -- Taxonomy ---------------------------------------------------------------
  primaryCategoryId: string | null

  // -- Structured data --------------------------------------------------------
  schemaType: SchemaType
  /** Raw JSON as stored. Parse with `parseSchemaData` from Values/Validations. */
  schemaData: string | null
  speakableSelectors: string[]

  // -- Editorial workflow -----------------------------------------------------
  reviewStatus: ReviewStatus
  reviewedBy: { id: string; name: string } | null
  reviewedAt: string | null
  reviewNote: string | null
}

export type SchemaType =
  | 'BlogPosting'
  | 'Article'
  | 'NewsArticle'
  | 'HowTo'
  | 'Review'
  | 'VideoObject'

export type ReviewStatus = 'none' | 'pending' | 'approved' | 'rejected'

export interface BlogPostRevision extends Record<string, unknown> {
  id: string
  postId: string
  title: string
  excerpt: string
  content: string
  editor: { id: string; name: string }
  createdAt: string
}

export interface BlogPostFaq extends Record<string, unknown> {
  id: string
  postId: string
  question: string
  answer: string
  priority: number
}

export interface BlogPostFaqPayload {
  question: string
  answer: string
}

/** A FAQ staged client-side before the post exists (Create flow). Has a
 *  locally-generated `id` and no `postId`/`priority` — order in the array is
 *  the priority, submitted to the server once the post itself is created. */
export interface BlogPostFaqDraft extends Record<string, unknown> {
  id: string
  question: string
  answer: string
}

export interface BlogPostPayload {
  title: string
  slug: string
  excerpt: string
  content: string
  featuredImageKey: string
  featuredImageAltText: string
  authorProfileId?: string
  categoryIds: string[]
  tagIds?: string[]
  metaTitle?: string
  metaDescription?: string
  canonicalUrl?: string
  ogImageKey?: string
  isIndexable?: boolean
  isPublished?: boolean
  scheduledPublishAt?: string

  focusKeyword?: string
  secondaryKeywords?: string[]
  primaryCategoryId?: string
  seriesId?: string
  seriesPosition?: number
  isCornerstone?: boolean
  schemaType?: SchemaType
  schemaData?: unknown
  speakableSelectors?: string[]

  /** Update only. Stamps `contentUpdatedAt`; never stored as a column. */
  isSubstantiveUpdate?: boolean
  /** Update only. Absent means "leave unchanged", so clearing needs its own
   *  flag rather than an empty string the sanitizer would strip anyway. */
  clearSeries?: boolean
  clearPrimaryCategory?: boolean
}
