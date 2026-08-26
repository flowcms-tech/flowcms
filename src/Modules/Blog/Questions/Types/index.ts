import type { QuestionStatus } from '../Values/Validations'

export interface BlogQuestionPostRef {
  id: string
  title: string
  slug: string
}

export interface BlogQuestion extends Record<string, unknown> {
  id: string
  postId: string
  /** Null only if the post was deleted between the read and the render — the
   *  FK cascades, so in practice this is always present. */
  post: BlogQuestionPostRef | null
  askerName: string | null
  question: string
  /** Null until an admin writes one. A published row always has one; the API
   *  refuses the transition otherwise. */
  answer: string | null
  status: QuestionStatus
  /** Ordering in the on-page Q&A block and in the FAQPage graph. */
  priority: number
  answeredBy: { id: string; name: string } | null
  answeredAt: string | null
  createdAt: string
}

export interface UpdateBlogQuestionPayload {
  answer?: string
  status?: QuestionStatus
  priority?: number
  askerName?: string
}
