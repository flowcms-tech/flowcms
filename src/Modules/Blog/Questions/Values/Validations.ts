import { z } from 'zod'

export const QUESTION_STATUSES = ['pending', 'published', 'rejected'] as const

export type QuestionStatus = (typeof QUESTION_STATUSES)[number]

export const QUESTION_STATUS_LABELS: Record<QuestionStatus, string> = {
  pending: 'Awaiting answer',
  published: 'Published',
  rejected: 'Rejected',
}

/**
 * The public submission.
 *
 * No email field, deliberately and permanently: collecting an address implies a
 * reply, and this app has no mail infrastructure to send one with. The name is
 * optional because a question is worth answering whether or not it is signed.
 */
export const createPublicQuestionSchema = z.object({
  postId: z.string().min(1, 'Missing post'),
  askerName: z.string().max(80, 'Name must be 80 characters or fewer').optional(),
  question: z
    .string()
    .min(10, 'Please write a bit more — 10 characters minimum')
    .max(1000, 'Questions are limited to 1000 characters'),
  captchaCode: z.string().min(1, 'Enter the security code'),
  /** Honeypot. A human never sees this field; a bot fills everything it finds.
   *  Named after a plausible input so it reads as real to a scraper. */
  website: z.string().max(200).optional(),
})

export type CreatePublicQuestionValues = z.infer<typeof createPublicQuestionSchema>

/**
 * The admin update.
 *
 * The publish transition and the answer are validated together, because
 * "published" without an answer is the one state this feature must never
 * produce — the whole premise is that nothing reaches the page or the FAQPage
 * graph until a human has written a reply. The route re-checks it against the
 * stored row too, since a PATCH can publish without resending the answer.
 */
export const updateQuestionSchema = z
  .object({
    answer: z.string().max(4000, 'Answers are limited to 4000 characters').optional(),
    status: z.enum(QUESTION_STATUSES).optional(),
    priority: z.number().int().min(0).max(999).optional(),
    /** Lightly editable: obvious spam in a display name should not force a
     *  reject when the question itself is good. */
    askerName: z.string().max(80).optional(),
  })
  .refine((value) => value.status !== 'published' || !!value.answer?.trim(), {
    message: 'A published question needs an answer',
    path: ['answer'],
  })

export type UpdateQuestionPayload = z.infer<typeof updateQuestionSchema>

/**
 * The drawer's own schema, and the one place this module deliberately does not
 * share one with the route.
 *
 * `ElementInput` is a text control: a number field hands back the string "3",
 * not 3. Coercing inside `updateQuestionSchema` would give it an `unknown`
 * input type, which leaks into the route's `safeParse` result and every type
 * derived from it — a real cost, to spare one `Number()` at the submit
 * boundary. So the form validates what a form actually holds, and converts.
 */
export const answerQuestionFormSchema = z
  .object({
    answer: z.string().max(4000, 'Answers are limited to 4000 characters').optional(),
    status: z.enum(QUESTION_STATUSES),
    priority: z
      .string()
      .regex(/^\d{1,3}$/, 'Priority must be a whole number between 0 and 999'),
    askerName: z.string().max(80).optional(),
  })
  .refine((value) => value.status !== 'published' || !!value.answer?.trim(), {
    message: 'A published question needs an answer',
    path: ['answer'],
  })

export type UpdateQuestionFormValues = z.infer<typeof answerQuestionFormSchema>
