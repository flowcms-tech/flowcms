import { z } from 'zod'

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const createBlogSeriesSchema = z.object({
  name:        z.string().min(1, 'Name is required').max(150),
  slug:        z.string().min(1, 'Slug is required').max(160).regex(slugPattern, 'Slug must contain only lowercase letters, numbers, and hyphens'),
  description: z.string().max(500).optional(),
})

export const updateBlogSeriesSchema = createBlogSeriesSchema.partial().extend({
  isActive: z.boolean().optional(),
})

export type CreateBlogSeriesFormValues = z.infer<typeof createBlogSeriesSchema>
export type UpdateBlogSeriesFormValues = z.infer<typeof updateBlogSeriesSchema>
