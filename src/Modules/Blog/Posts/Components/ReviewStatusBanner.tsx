'use client'

import { CheckCircle2, Clock, MessageSquareWarning } from 'lucide-react'
import { format } from 'date-fns'
import { REVIEW_STATUS_LABELS, type ReviewStatus } from '../Values/reviewWorkflow'

interface ReviewStatusBannerProps {
  status: ReviewStatus
  /** Name of the editor who approved or rejected. Null before any decision. */
  reviewedByName?: string | null
  reviewedAt?: string | Date | null
  /** Mandatory on a rejection — the route refuses one without it. */
  reviewNote?: string | null
  className?: string
}

const TONE: Record<Exclude<ReviewStatus, 'none'>, { wrapper: string; icon: typeof Clock }> = {
  pending: {
    wrapper: 'border-info/40 bg-info-light text-info',
    icon: Clock,
  },
  approved: {
    wrapper: 'border-success/40 bg-success-light text-success',
    icon: CheckCircle2,
  },
  rejected: {
    wrapper: 'border-warning/40 bg-warning-light text-warning',
    icon: MessageSquareWarning,
  },
}

const DETAIL: Record<Exclude<ReviewStatus, 'none'>, string> = {
  pending: 'Waiting for an editor to look at it. You can keep editing — they see the latest saved version.',
  approved: 'An editor has approved this. Approval is not publication: it still has to be published.',
  rejected: 'An editor asked for changes. Make them, then submit for review again.',
}

/**
 * The review state of the post being edited, shown to whoever wrote it.
 *
 * Renders nothing at `none`, which is the common and correct state for a post
 * an editor wrote themselves — review is an orthogonal axis to publication, not
 * a stage every post passes through, and a permanent "Not submitted" banner
 * would imply otherwise.
 *
 * The rejection note is the load-bearing part: a rejection with no reason just
 * produces a resubmission of the same post, which is why the API makes the note
 * mandatory and why this component gives it the most space.
 */
export default function ReviewStatusBanner({
  status,
  reviewedByName,
  reviewedAt,
  reviewNote,
  className,
}: ReviewStatusBannerProps) {
  if (status === 'none') return null

  const tone = TONE[status]
  const Icon = tone.icon
  const stampedAt = reviewedAt ? new Date(reviewedAt) : null

  return (
    <div
      className={`flex gap-3 rounded-lg border p-4 ${tone.wrapper} ${className ?? ''}`}
      role="status"
    >
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium">{REVIEW_STATUS_LABELS[status]}</p>
        <p className="text-xs opacity-90">{DETAIL[status]}</p>

        {reviewNote && (
          <p className="mt-2 whitespace-pre-wrap rounded-md bg-background/60 p-3 text-sm text-foreground">
            {reviewNote}
          </p>
        )}

        {(reviewedByName || stampedAt) && (
          <p className="mt-1 text-xs opacity-75">
            {reviewedByName ? `Reviewed by ${reviewedByName}` : 'Reviewed'}
            {stampedAt ? ` on ${format(stampedAt, 'MMM d, yyyy')}` : ''}
          </p>
        )}
      </div>
    </div>
  )
}
