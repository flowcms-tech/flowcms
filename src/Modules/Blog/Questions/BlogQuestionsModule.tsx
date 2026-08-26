'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import { BlogQuestionServices } from './Services/BlogQuestionServices'
import { buildColumns } from './Values/BlogQuestionValues'
import { QUESTION_STATUS_LABELS, type QuestionStatus } from './Values/Validations'
import QuestionAnswerDrawer from './Components/QuestionAnswerDrawer'
import type { BlogQuestion } from './Types'

const FILTERS: { value: QuestionStatus; label: string }[] = [
  { value: 'pending', label: QUESTION_STATUS_LABELS.pending },
  { value: 'published', label: QUESTION_STATUS_LABELS.published },
  { value: 'rejected', label: QUESTION_STATUS_LABELS.rejected },
]

/**
 * The moderation queue for reader questions.
 *
 * This is not a comments screen. Nothing here is public until someone writes an
 * answer and presses Publish — the question is raw input, the answer is the
 * product, and the pair is what joins the post's hand-authored FAQs in the
 * FAQPage graph.
 *
 * Defaults to Pending, because the only reason to open this screen is that
 * something is waiting.
 */
export default function BlogQuestionsModule() {
  const adminHref = useAdminHref()
  const queryClient = useQueryClient()

  const [status, setStatus] = useState<QuestionStatus>('pending')
  const [answerTarget, setAnswerTarget] = useState<BlogQuestion | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BlogQuestion | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['blog-questions-list', status],
    queryFn: () => BlogQuestionServices.list({ status }),
  })

  const questions = data ?? []

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['blog-questions-list'] })

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setActionLoading(true)
    try {
      await BlogQuestionServices.delete(deleteTarget.id)
      await invalidate()
    } catch {
      // The global error toast already surfaced this.
      return
    } finally {
      setActionLoading(false)
    }
    setDeleteTarget(null)
  }

  const columns = buildColumns(setAnswerTarget, setDeleteTarget, adminHref)

  const header = (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold">Reader questions</p>
        <p className="text-xs text-muted-foreground">
          Nothing a reader sends appears on the site until you answer it and publish it.
          Published pairs render on the post and feed its FAQ structured data.
        </p>
      </div>
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((filter) => (
          <ElementButton
            key={filter.value}
            size="sm"
            variant={status === filter.value ? 'primary' : 'outline'}
            onClick={() => setStatus(filter.value)}
          >
            {filter.label}
          </ElementButton>
        ))}
      </div>
    </div>
  )

  return (
    <>
      <QuestionAnswerDrawer
        isOpen={answerTarget !== null}
        setIsOpen={(open) => { if (!open) setAnswerTarget(null) }}
        question={answerTarget}
        onSaved={invalidate}
      />

      <ElementModal.Confirm
        isOpen={deleteTarget !== null}
        onClose={(v) => { if (!v) setDeleteTarget(null) }}
        variant="danger"
        title="Delete question"
        description={
          deleteTarget
            ? 'Delete this question outright? Use Reject instead for a genuine question you chose not to answer — deletion is for spam, and it cannot be undone.'
            : undefined
        }
        confirmText="Delete"
        cancelText="Cancel"
        isLoading={actionLoading}
        onConfirm={handleConfirmDelete}
      />

      <ElementTable<BlogQuestion>
        columns={columns}
        data={questions}
        loading={isLoading}
        loadingRows={5}
        headerContent={header}
        emptyContent={<p>No questions in this state</p>}
      />
    </>
  )
}
