import { z } from 'zod'

export const ISSUE_TYPES = ['manual_action', 'security_issue'] as const
export const ISSUE_STATUSES = ['open', 'resolved'] as const

export const createIssueSchema = z.object({
  type: z.enum(ISSUE_TYPES),
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(2000).optional(),
  url: z.string().max(2000).optional(),
  detectedAt: z.string().optional(),
  status: z.enum(ISSUE_STATUSES).default('open'),
  notes: z.string().max(2000).optional(),
})

export const updateIssueSchema = createIssueSchema.partial()

export type CreateIssueFormValues = z.input<typeof createIssueSchema>
export type UpdateIssueFormValues = z.input<typeof updateIssueSchema>
