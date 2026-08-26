import { z } from 'zod'
import { isReservedPath } from '@/Framework/Functions/reservedPaths'

const pathPattern = /^\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/

export const createPageSchema = z.object({
  title:            z.string().min(1, 'Title is required').max(150),
  path:             z.string()
                      .min(1, 'Path is required')
                      .max(300)
                      .regex(pathPattern, 'Must be an absolute path, lowercase letters/numbers/hyphens per segment (e.g. /privacy-policy or /legal/terms)')
                      .refine((p) => !isReservedPath(p), { message: "This path is reserved" }),
  content:          z.string().min(1, 'Content is required'),
  metaTitle:        z.string().max(70).optional(),
  metaDescription:  z.string().max(160).optional(),
  canonicalUrl:     z.union([z.string().url('Invalid URL').max(300), z.literal('')]).optional(),
  ogImageKey:       z.string().optional().nullable(),
  /**
   * `.optional()`, deliberately not `.default(true)` — see blogCategories'
   * isIndexable for the same reasoning. `updatePageSchema` is `.partial()`
   * of this object, and `.partial()` does not strip a `.default()` wrapper —
   * a PATCH carrying only `{ isPublished }` would otherwise silently
   * re-index a page an admin had deliberately hidden from search. The
   * `true` default is applied on create by the route instead.
   */
  isIndexable:      z.boolean().optional(),
})

export const updatePageSchema = createPageSchema.partial().extend({
  isPublished: z.boolean().optional(),
})

export type CreatePageFormValues = z.infer<typeof createPageSchema>
export type UpdatePageFormValues = z.infer<typeof updatePageSchema>
