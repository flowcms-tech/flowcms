import { z } from 'zod'

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Optional URL that also accepts '' — the form submits empty strings, not
 *  undefined, and a blank profile link is a valid choice rather than an error. */
const optionalUrl = (label: string) =>
  z.union([z.string().url(`${label} must be a valid URL`).max(300), z.literal('')]).optional()

export const createAuthorSchema = z.object({
  name:            z.string().min(1, 'Name is required').max(150),
  slug:            z.string().min(1, 'Slug is required').max(160).regex(slugPattern, 'Slug must contain only lowercase letters, numbers, and hyphens'),

  // E-E-A-T: what makes a byline credible to both readers and Google.
  jobTitle:        z.string().max(120, 'Keep the job title under 120 characters').optional(),
  credentials:     z.string().max(200, 'Keep credentials under 200 characters').optional(),
  bio:             z.string().max(500, 'Keep the bio under 500 characters').optional(),

  avatarKey:       z.string().optional(),
  avatarAltText:   z.string().max(125, 'Keep alt text under 125 characters').optional(),

  email:           z.union([z.string().email('Invalid email address').max(200), z.literal('')]).optional(),

  websiteUrl:      optionalUrl('Website'),
  linkedinUrl:     optionalUrl('LinkedIn'),
  twitterUrl:      optionalUrl('X / Twitter'),
  facebookUrl:     optionalUrl('Facebook'),
  instagramUrl:    optionalUrl('Instagram'),

  metaTitle:       z.string().max(70).optional(),
  metaDescription: z.string().max(160).optional(),
  canonicalUrl:    optionalUrl('Canonical URL'),
  isIndexable:     z.boolean().optional(),
})

// No `.default()` anywhere above, so `.partial()` is safe here — absent keys
// stay absent instead of being silently filled in on a PATCH.
export const updateAuthorSchema = createAuthorSchema.partial().extend({
  isActive: z.boolean().optional(),
})

export type CreateAuthorFormValues = z.infer<typeof createAuthorSchema>
export type UpdateAuthorFormValues = z.infer<typeof updateAuthorSchema>
