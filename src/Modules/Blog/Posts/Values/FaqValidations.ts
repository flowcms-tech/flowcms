import { z } from 'zod'

export const createFaqSchema = z.object({
  question: z.string().min(1, 'Question is required').max(300),
  // Answer is rich-text HTML from ElementEditor, not plain text — the cap
  // needs headroom for markup (<p>, <strong>, <a href="...">, etc.) on top
  // of the actual answer content.
  answer: z.string().min(1, 'Answer is required').max(4000),
})

export const updateFaqSchema = createFaqSchema.partial()

export type CreateFaqFormValues = z.input<typeof createFaqSchema>
export type UpdateFaqFormValues = z.input<typeof updateFaqSchema>
