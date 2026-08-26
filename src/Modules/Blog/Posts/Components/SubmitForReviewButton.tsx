'use client'

import { useState } from 'react'
import { SendHorizontal } from 'lucide-react'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { ReviewServices } from '../Services/ReviewServices'
import type { ReviewStatus } from '../Values/reviewWorkflow'

interface SubmitForReviewButtonProps {
  postId: string
  status: ReviewStatus
  /** Fired after a successful submit so the caller can refresh the post. */
  onSubmitted?: (nextStatus: ReviewStatus) => void
  className?: string
}

/**
 * The contributor's way out of a draft: hand it to an editor.
 *
 * Disabled rather than hidden while `pending`, with the reason on the button —
 * a control that vanishes after you click it leaves you wondering whether the
 * click registered, and "submit again" is the natural next thought.
 *
 * There is deliberately no "withdraw": a contributor who changes their mind
 * just keeps editing, and the reviewer sees the latest saved version anyway.
 */
export default function SubmitForReviewButton({
  postId,
  status,
  onSubmitted,
  className,
}: SubmitForReviewButtonProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const isPending = status === 'pending'

  const handleClick = async () => {
    setErrors([])
    setIsSubmitting(true)
    try {
      const result = await ReviewServices.act(postId, 'submit')
      onSubmitted?.(result.reviewStatus)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { message?: string | string[] } } }
      const raw = axiosErr.response?.data?.message
      setErrors(Array.isArray(raw) ? raw : raw ? [raw] : ['Could not submit this post for review'])
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      <ElementButton
        variant="outline"
        size="sm"
        onClick={handleClick}
        isLoading={isSubmitting}
        disabled={isPending}
      >
        <SendHorizontal size={15} />
        {isPending ? 'Waiting for review' : status === 'rejected' ? 'Resubmit for review' : 'Submit for review'}
      </ElementButton>

      <ValidationBox messages={errors} />
    </div>
  )
}
