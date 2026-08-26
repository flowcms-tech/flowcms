import { z } from 'zod'
import type {
  HowToData as ContractHowToData,
  ReviewData as ContractReviewData,
  VideoData as ContractVideoData,
} from "@/Themes/contract/views"

/** Canonical slug shape, shared by every slugged entity. Uppercase is REJECTED
 *  rather than lowercased: telling an operator their slug is invalid beats
 *  silently giving them a different URL than they typed, and rejection behaves
 *  identically on case-sensitive and case-insensitive engines alike. */
export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// -- Structured-data payloads -------------------------------------------------
// One schema per `schemaType` that carries extra data. Kept as discrete
// schemas rather than one loose object so a HowTo missing its steps fails at
// the API edge with a usable message, instead of emitting JSON-LD that the
// Rich Results Test rejects after the post is already live.

export const howToSchemaData = z.object({
  totalTime: z.string().max(60).optional(),
  estimatedCost: z.string().max(60).optional(),
  tools: z.array(z.string().max(120)).default([]),
  supplies: z.array(z.string().max(120)).default([]),
  // Two is the minimum that is meaningfully a procedure. Google also rejects
  // single-step HowTo markup.
  steps: z
    .array(
      z.object({
        name: z.string().min(1, 'Each step needs a name').max(200),
        text: z.string().min(1, 'Each step needs instructions').max(1500),
        imageKey: z.string().optional(),
      })
    )
    .min(2, 'A HowTo needs at least two steps'),
})

export const reviewSchemaData = z.object({
  itemName: z.string().min(1, 'Name the thing being reviewed').max(200),
  itemType: z.string().min(1).max(60).default('Product'),
  rating: z.number().min(0).max(10),
  bestRating: z.number().min(1).max(10).default(5),
  worstRating: z.number().min(0).max(10).default(1),
  pros: z.array(z.string().max(200)).default([]),
  cons: z.array(z.string().max(200)).default([]),
})

export const videoSchemaData = z.object({
  contentUrl: z.string().url('Invalid video URL').max(500),
  embedUrl: z.union([z.string().url('Invalid embed URL').max(500), z.literal('')]).optional(),
  thumbnailKey: z.string().optional(),
  uploadDate: z.string().min(1, 'Upload date is required'),
  // ISO 8601 duration, e.g. PT4M30S — the only format schema.org accepts.
  duration: z
    .union([z.string().regex(/^PT(\d+H)?(\d+M)?(\d+S)?$/, 'Use ISO 8601, e.g. PT4M30S'), z.literal('')])
    .optional(),
})

export const SCHEMA_TYPES = [
  'BlogPosting',
  'Article',
  'NewsArticle',
  'HowTo',
  'Review',
  'VideoObject',
] as const

/** Which payload schema, if any, each `schemaType` requires. */
const SCHEMA_DATA_BY_TYPE = {
  HowTo: howToSchemaData,
  Review: reviewSchemaData,
  VideoObject: videoSchemaData,
} as const

const createBlogPostObject = z.object({
  title:            z.string().min(1, 'Title is required').max(200),
  slug:             z.string().min(1, 'Slug is required').max(200).regex(slugPattern, 'Slug must contain only lowercase letters, numbers, and hyphens'),
  excerpt:          z.string().min(1, 'Description is required').max(300),
  content:          z.string().min(1, 'Content is required').max(50000),
  featuredImageKey: z.string().min(1, 'Featured image is required'),
  // Nullable in the DB so the migration applied to existing rows, but required
  // here so no new post ships without it. 125 chars is where screen readers
  // start truncating.
  featuredImageAltText: z.string().min(1, 'Image alt text is required').max(125, 'Keep alt text under 125 characters'),
  // Optional, not required: posts created before the Authors module exist
  // without one, and the public byline falls back to the creating admin's
  // name rather than rendering blank.
  authorProfileId:  z.string().optional(),
  categoryIds:      z.array(z.string()).min(1, 'Select at least one category'),
  tagIds:           z.array(z.string()).default([]),
  metaTitle:        z.string().min(1, 'Meta title is required').max(70),
  metaDescription:  z.string().min(1, 'Meta description is required').max(160),
  canonicalUrl:     z.union([z.string().url('Invalid URL').max(300), z.literal('')]).optional(),
  // Optional — falls back to featuredImageKey when blank (see
  // buildPostMetadata). Meta Title/Description double as the social title
  // and description too, so there's no separate override for those.
  ogImageKey:       z.string().optional(),
  isIndexable:      z.boolean().default(true),
  isPublished:      z.boolean().default(false),
  // 'yyyy-MM-dd' from ElementDatePicker. Leave empty to publish immediately
  // when Publish is clicked; set a future date to schedule it instead.
  scheduledPublishAt: z.string().optional(),

  // -- Focus keyword and analysis --------------------------------------------
  // Optional, deliberately. The SEO panel treats a missing focus keyword as
  // "not applicable" rather than a failure, so requiring one here would fight
  // the analyser's own design.
  focusKeyword: z.string().max(100).optional(),
  secondaryKeywords: z.array(z.string().max(100)).max(4, 'Four supporting keywords is the useful limit').default([]),

  // -- Taxonomy ---------------------------------------------------------------
  // Must be one of `categoryIds` — enforced in `refinePostRules`, not here,
  // because it is a cross-field rule.
  primaryCategoryId: z.string().optional(),

  // -- Content structure ------------------------------------------------------
  seriesId: z.string().optional(),
  seriesPosition: z.number().int().min(1).max(999).optional(),
  isCornerstone: z.boolean().default(false),

  // -- Structured data --------------------------------------------------------
  schemaType: z.enum(SCHEMA_TYPES).default('BlogPosting'),
  // Validated against `schemaType` in `refinePostRules`. `unknown` here rather
  // than a discriminated union because the discriminant lives in a sibling
  // field, not inside the payload.
  schemaData: z.unknown().optional(),
  speakableSelectors: z.array(z.string().max(120)).max(5).default([]),
})

/**
 * Cross-field rules, shared by create and update.
 *
 * Applied with `.superRefine` AFTER the object schemas are derived from each
 * other — a refinement attached to the base would either be inherited into the
 * update schema with create-only assumptions baked in, or be silently dropped
 * by `.omit()`. Both are worse than declaring it once and applying it twice.
 *
 * Every check is written to no-op when the field is absent, because on a PATCH
 * absent means "leave unchanged" and there is nothing to validate.
 */
function refinePostRules(
  value: {
    categoryIds?: string[]
    primaryCategoryId?: string
    schemaType?: (typeof SCHEMA_TYPES)[number]
    schemaData?: unknown
    seriesId?: string
    seriesPosition?: number
  },
  ctx: z.RefinementCtx
) {
  if (value.primaryCategoryId && value.categoryIds && !value.categoryIds.includes(value.primaryCategoryId)) {
    ctx.addIssue({
      code: 'custom',
      path: ['primaryCategoryId'],
      message: 'The primary category must be one of the selected categories',
    })
  }

  // A position without a series is meaningless, and orders the post against
  // nothing. The reverse is fine: a series member with no position sorts last.
  if (value.seriesPosition !== undefined && !value.seriesId) {
    ctx.addIssue({
      code: 'custom',
      path: ['seriesPosition'],
      message: 'Choose a series before setting a position in it',
    })
  }

  if (!value.schemaType) return
  const payloadSchema = SCHEMA_DATA_BY_TYPE[value.schemaType as keyof typeof SCHEMA_DATA_BY_TYPE]
  if (!payloadSchema) return

  const parsed = payloadSchema.safeParse(value.schemaData ?? {})
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue({
        code: 'custom',
        path: ['schemaData', ...issue.path],
        message: issue.message,
      })
    }
  }
}

export const createBlogPostSchema = createBlogPostObject.superRefine(refinePostRules)

// `.partial()` alone is NOT enough: it makes keys optional but leaves the
// `.default()` wrappers intact, so Zod fills them in for absent keys. A PATCH
// body of `{ isIndexable: false }` would parse to
// `{ tagIds: [], isPublished: false, isIndexable: false }` — silently
// unpublishing the post and deleting every one of its tags. On an update
// schema, absent must mean "leave unchanged", so the defaulted fields are
// re-declared as plain optionals.
const updateBlogPostObject = createBlogPostObject
  .omit({
    tagIds: true,
    isPublished: true,
    isIndexable: true,
    // Every field below uses `.default()` too, so each one has to make the
    // same round trip. Adding a defaulted field to the create schema without
    // adding it here reintroduces the exact data-loss bug described above.
    secondaryKeywords: true,
    isCornerstone: true,
    schemaType: true,
    speakableSelectors: true,
  })
  .partial()
  .extend({
    tagIds: z.array(z.string()).optional(),
    isPublished: z.boolean().optional(),
    isIndexable: z.boolean().optional(),
    secondaryKeywords: z.array(z.string().max(100)).max(4).optional(),
    isCornerstone: z.boolean().optional(),
    schemaType: z.enum(SCHEMA_TYPES).optional(),
    speakableSelectors: z.array(z.string().max(120)).max(5).optional(),

    // Update-only, and never stored as-is: when true the route stamps
    // `contentUpdatedAt = now`. Unchecked by default, because `updatedAt`
    // bumps on a typo fix and emitting that as `dateModified` is the
    // re-dating pattern Google treats as manipulative.
    isSubstantiveUpdate: z.boolean().optional(),

    // Clearing a relation needs a value distinct from "absent". Empty string
    // means "unset this"; absent still means "leave unchanged".
    clearSeries: z.boolean().optional(),
    clearPrimaryCategory: z.boolean().optional(),
  })

export const updateBlogPostSchema = updateBlogPostObject.superRefine(refinePostRules)

// z.input (not z.infer/z.output) — react-hook-form's useForm generic must
// match the resolver's pre-parse field shape, where tagIds/isPublished
// (both use .default()) are still optional. Categories/Tags schemas don't
// hit this because they have no .default() fields, so input === output there.
export type CreateBlogPostFormValues = z.input<typeof createBlogPostSchema>
export type UpdateBlogPostFormValues = z.input<typeof updateBlogPostSchema>

export type SchemaType = (typeof SCHEMA_TYPES)[number]
export type HowToSchemaData = z.infer<typeof howToSchemaData>
export type ReviewSchemaData = z.infer<typeof reviewSchemaData>
export type VideoSchemaData = z.infer<typeof videoSchemaData>

/**
 * These three payloads are also a PUBLIC theme type — a theme renders
 * `view.howTo`, `view.review` and `view.video` — so the contract declares them
 * as plain interfaces and this file is checked against those declarations.
 *
 * The direction is deliberate. Before Phase 7.2 the contract went the other
 * way, `HowToData = ReturnType<typeof howToDataFor>`, which made every theme's
 * `.d.ts` depend on Zod and made every tweak to an ADMIN FORM schema a
 * potentially breaking change for themes. Now a divergence fails here, in the
 * file that caused it, at typecheck.
 *
 * Mutual assignability, not one-way: a field added on either side without the
 * other is an error rather than a silent widening.
 */
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
const _howToMatchesContract: Exactly<HowToSchemaData, NonNullable<ContractHowToData>> = true
const _reviewMatchesContract: Exactly<ReviewSchemaData, NonNullable<ContractReviewData>> = true
const _videoMatchesContract: Exactly<VideoSchemaData, NonNullable<ContractVideoData>> = true
void _howToMatchesContract
void _reviewMatchesContract
void _videoMatchesContract

/**
 * Parse a stored `schemaData` string against the post's `schemaType`.
 *
 * Returns null rather than throwing: a post whose payload predates a schema
 * change must still render, just without the type-specific markup. Emitting
 * nothing is always safer than emitting a malformed graph, which is a Rich
 * Results error rather than a missing enhancement.
 */
export function parseSchemaData(schemaType: string, raw: string | null): unknown | null {
  if (!raw) return null
  const payloadSchema = SCHEMA_DATA_BY_TYPE[schemaType as keyof typeof SCHEMA_DATA_BY_TYPE]
  if (!payloadSchema) return null

  try {
    const parsed = payloadSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
