import { z } from 'zod'

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const createBlogCategorySchema = z.object({
  name:             z.string().min(1, 'Name is required').max(150),
  slug:             z.string().min(1, 'Slug is required').max(160).regex(slugPattern, 'Slug must contain only lowercase letters, numbers, and hyphens'),
  description:      z.string().max(500).optional(),
  parentId:         z.string().optional().nullable(),
  imageKey:         z.string().optional().nullable(),
  ogImageKey:       z.string().optional().nullable(),
  metaTitle:        z.string().max(70).optional(),
  metaDescription:  z.string().max(160).optional(),
  canonicalUrl:     z.union([z.string().url('Invalid URL').max(300), z.literal('')]).optional(),
  /**
   * `.optional()`, deliberately not `.default(true)`.
   *
   * `updateBlogCategorySchema` below is `.partial()` of this object, and
   * `.partial()` does not strip a `.default()` wrapper — a PATCH carrying only
   * `{ isActive }` would parse to an object containing `isIndexable: true` and
   * silently re-index a category the admin had deliberately hidden from search.
   * The route applies the `true` default on create instead.
   */
  isIndexable:      z.boolean().optional(),
  /** Plain text, stored verbatim and escaped at render by the public archive —
   *  no HTML sanitiser involved, so nothing an editor types can become markup. */
  archiveIntro:     z.string().max(2000, 'Archive intro must be 2000 characters or fewer').optional(),
})

export const updateBlogCategorySchema = createBlogCategorySchema.partial().extend({
  isActive: z.boolean().optional(),
})

export type CreateBlogCategoryFormValues = z.infer<typeof createBlogCategorySchema>
export type UpdateBlogCategoryFormValues = z.infer<typeof updateBlogCategorySchema>
