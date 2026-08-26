'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ElementTextArea from '@/components/shared/ElementTextArea/ElementTextArea'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { ReviewServices } from '@/Modules/Blog/Posts/Services/ReviewServices'
import type { ReviewStatus } from '@/Modules/Blog/Posts/Values/reviewWorkflow'
import { PendingReviewServices } from './Services/PendingReviewServices'
import { buildColumns } from './Values/PendingReviewValues'
import type { PendingReviewPost } from './Types'

interface PendingReviewModuleProps {
  currentUserId: string
}

const TABS: { value: ReviewStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'rejected', label: 'Changes requested' },
  { value: 'approved', label: 'Approved' },
]

/**
 * The editor's queue.
 *
 * Three tabs rather than one list, because the three states answer different
 * questions: Pending is "what needs me now", Changes requested is "what am I
 * waiting on someone else for", and Approved is "what is cleared but not yet
 * live". A single list sorted by status buries the first behind the third the
 * moment the site has any history.
 */
export default function PendingReviewModule({ currentUserId }: PendingReviewModuleProps) {
  const adminHref = useAdminHref()
  const queryClient = useQueryClient()

  const [status, setStatus] = useState<ReviewStatus>('pending')
  const [approveTarget, setApproveTarget] = useState<PendingReviewPost | null>(null)
  const [rejectTarget, setRejectTarget] = useState<PendingReviewPost | null>(null)
  const [note, setNote] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const { data, isLoading } = useQuery({
    queryKey: ['blog-review-queue', status],
    queryFn: () => PendingReviewServices.list(status),
  })

  const posts = data ?? []

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['blog-review-queue'] }),
      // The posts list shows the same reviewStatus badge, so it goes stale too.
      queryClient.invalidateQueries({ queryKey: ['blog-posts-list'] }),
    ])

  const handleApprove = async () => {
    if (!approveTarget) return
    setErrors([])
    setActionLoading(true)
    try {
      await ReviewServices.act(approveTarget.id, 'approve')
      await invalidate()
      setApproveTarget(null)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string | string[] } } }
      const raw = axiosErr.response?.data?.message
      setErrors(Array.isArray(raw) ? raw : raw ? [raw] : ['Could not approve this post'])
    } finally {
      setActionLoading(false)
    }
  }

  const handleReject = async () => {
    if (!rejectTarget) return
    setErrors([])
    setActionLoading(true)
    try {
      await ReviewServices.act(rejectTarget.id, 'reject', note)
      await invalidate()
      setRejectTarget(null)
      setNote('')
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string | string[] } } }
      const raw = axiosErr.response?.data?.message
      setErrors(Array.isArray(raw) ? raw : raw ? [raw] : ['Could not send this back'])
    } finally {
      setActionLoading(false)
    }
  }

  const columns = buildColumns(setApproveTarget, setRejectTarget, currentUserId, adminHref)

  const header = (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold">Review queue</p>
        <p className="text-xs text-muted-foreground">
          Approving marks a post as reviewed. It does not publish it — that stays a
          separate, deliberate decision.
        </p>
      </div>
      {/* A plain segmented control rather than ElementTabs: the tabs switch
          which rows the one table below shows, and ElementTabs owns its own
          per-tab panels — which would mean three tables to keep in sync. */}
      <div className="flex flex-wrap gap-1">
        {TABS.map((tab) => (
          <ElementButton
            key={tab.value}
            size="sm"
            variant={status === tab.value ? 'primary' : 'outline'}
            onClick={() => setStatus(tab.value)}
          >
            {tab.label}
          </ElementButton>
        ))}
      </div>
    </div>
  )

  return (
    <>
      <ElementModal.Confirm
        isOpen={approveTarget !== null}
        onClose={(v) => { if (!v) { setApproveTarget(null); setErrors([]) } }}
        variant="default"
        title="Approve post"
        description={
          approveTarget
            ? `Approve "${approveTarget.title}"? This records your sign-off; publishing is still a separate step.`
            : undefined
        }
        confirmText="Approve"
        cancelText="Cancel"
        isLoading={actionLoading}
        onConfirm={handleApprove}
      >
        <ValidationBox messages={errors} />
      </ElementModal.Confirm>

      <ElementModal.Confirm
        isOpen={rejectTarget !== null}
        onClose={(v) => { if (!v) { setRejectTarget(null); setNote(''); setErrors([]) } }}
        variant="default"
        title="Request changes"
        description={
          rejectTarget
            ? `Send "${rejectTarget.title}" back to its author. The note below is what they will see.`
            : undefined
        }
        confirmText="Send back"
        cancelText="Cancel"
        isLoading={actionLoading}
        /* A rejection with no reason just produces a resubmission of the same
           post, so the note is required here and again at the route. */
        disabledConfirm={!note.trim()}
        onConfirm={handleReject}
      >
        <div className="flex flex-col gap-2">
          <ElementTextArea
            value={note}
            onChange={setNote}
            label="What needs to change?"
            placeholder="Be specific — this is the only thing the author has to work from."
            rows={4}
            maxLength={2000}
            required
          />
          <ValidationBox messages={errors} />
        </div>
      </ElementModal.Confirm>

      <ElementTable<PendingReviewPost>
        columns={columns}
        data={posts}
        loading={isLoading}
        loadingRows={5}
        headerContent={header}
        emptyContent={<p>Nothing here — the queue is clear.</p>}
      />
    </>
  )
}
