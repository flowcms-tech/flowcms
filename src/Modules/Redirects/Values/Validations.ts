import { z } from 'zod'
import { isReservedPath } from '@/Framework/Functions/reservedPaths'

// Resolution happens in each top-level route's not-found branch
// (src/app/blog/[slug]/page.tsx, its category/tag siblings, and
// src/app/[...path]/page.tsx for custom pages) — any absolute path is
// potentially real now, not just /blog/... ones. Reserved top-level paths
// (the admin namespace, api, blog, the sitemap/robots/favicon routes) are rejected
// below since a redirect there could never fire.
const fromPathPattern = /^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/

const toPathPattern = /^(\/[a-z0-9-/]*|https?:\/\/.+)$/i

export const createRedirectSchema = z.object({
  fromPath: z.string()
    .min(1, 'From path is required')
    .max(300)
    .regex(fromPathPattern, 'Must be an absolute path (lowercase letters, numbers, hyphens)')
    .refine((path) => !isReservedPath(path), { message: "This path is reserved and can't be redirected" }),
  toPath: z.string()
    .min(1, 'To path is required')
    .max(500)
    .regex(toPathPattern, 'Must be a path starting with / or a full https:// URL'),
  // 301 (permanent) is overwhelmingly the right choice for "this content
  // moved for good" — the case this screen exists for — so it's the
  // default rather than something the admin has to remember to pick.
  statusCode: z.union([z.literal(301), z.literal(302)]).default(301),
  // Only meaningful on create: a redirect for a path a live, published post
  // still occupies would never fire (the post wins), so the API refuses
  // unless this explicitly asks it to also move that post to the trash in
  // the same transaction.
  alsoTrashSourcePost: z.boolean().optional(),
})

export const updateRedirectSchema = z.object({
  toPath: z.string()
    .min(1, 'To path is required')
    .max(500)
    .regex(toPathPattern, 'Must be a path starting with / or a full https:// URL'),
  statusCode: z.union([z.literal(301), z.literal(302)]),
})

// CSV import. `confirm` is the whole safety model: false is a dry run that
// writes nothing and returns the validation report, so an admin sees every
// rejected row and its reason before a single redirect changes. Defaulting it
// to false means a client that forgets the flag gets the safe behaviour.
export const importRedirectsSchema = z.object({
  csv: z.string().min(1, 'Paste or upload a CSV first').max(1_000_000),
  confirm: z.boolean().default(false),
})

export type ImportRedirectsPayload = z.input<typeof importRedirectsSchema>

export type CreateRedirectFormValues = z.infer<typeof createRedirectSchema>
export type UpdateRedirectFormValues = z.infer<typeof updateRedirectSchema>

// -- Form-level variants ---------------------------------------------------
// ElementSelect values are always strings, but the API (and the DB column)
// wants statusCode as a real number — same shape mismatch this codebase
// already solves elsewhere by combining/splitting fields around the submit
// boundary (e.g. blog posts' scheduledPublishDate/Time). Converted with
// Number(...) right before calling the service.

export const createRedirectFormSchema = createRedirectSchema.extend({
  statusCode: z.enum(['301', '302']).default('301'),
})
export const updateRedirectFormSchema = updateRedirectSchema.extend({
  statusCode: z.enum(['301', '302']),
})

// z.input, not z.infer: statusCode uses .default(), which makes it optional
// in the pre-parse shape react-hook-form's generic has to match (same
// reasoning as CreateBlogPostFormValues in the Blog Posts module).
export type CreateRedirectFormFields = z.input<typeof createRedirectFormSchema>
export type UpdateRedirectFormFields = z.input<typeof updateRedirectFormSchema>
