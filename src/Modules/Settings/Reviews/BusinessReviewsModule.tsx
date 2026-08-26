'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Plus, AlertTriangle } from 'lucide-react'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ElementFilterBar from '@/components/shared/ElementFilterBar/ElementFilterBar'
import SettingsShell from '@/Modules/Settings/Components/SettingsShell'
import { BusinessReviewServices } from './Services/BusinessReviewServices'
import { buildColumns, AGGREGATE_RATING_MIN_REVIEWS } from './Values/BusinessReviewValues'
import BusinessReviewCreateDrawer from './Components/BusinessReviewCreateDrawer'
import BusinessReviewEditDrawer from './Components/BusinessReviewEditDrawer'
import type { BusinessReview } from './Types'

interface SearchForm {
  search: string
}

export default function BusinessReviewsModule() {
  const queryClient = useQueryClient()

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<BusinessReview | null>(null)
  const [publishTarget, setPublishTarget] = useState<BusinessReview | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BusinessReview | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const methods = useForm<SearchForm>({ defaultValues: { search: '' } })
  const search = methods.watch('search')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(timer)
  }, [search])

  const { data, isLoading } = useQuery({
    queryKey: ['business-reviews-list', debouncedSearch],
    queryFn: () => BusinessReviewServices.list(debouncedSearch || undefined),
  })

  const reviews = data ?? []
  const publishedCount = reviews.filter((review) => review.isPublished).length

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['business-reviews-list'] })

  const handleConfirmTogglePublished = async () => {
    if (!publishTarget) return
    setActionLoading(true)
    try {
      await BusinessReviewServices.changePublished(publishTarget.id, !publishTarget.isPublished)
      await invalidate()
    } catch {
      return
    } finally {
      setActionLoading(false)
    }
    setPublishTarget(null)
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setActionLoading(true)
    try {
      await BusinessReviewServices.delete(deleteTarget.id)
      await invalidate()
    } catch {
      return
    } finally {
      setActionLoading(false)
    }
    setDeleteTarget(null)
  }

  const columns = buildColumns(setEditTarget, setPublishTarget, setDeleteTarget)

  const header = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-sm">Customer Reviews</p>
        <ElementButton size="sm" onClick={() => setIsCreateOpen(true)}>
          <Plus size={15} />
          Add Review
        </ElementButton>
      </div>
      <ElementFilterBar triggerLabel="Filters" activeCount={[debouncedSearch].filter(Boolean).length}>
        <FormProvider {...methods}>
          <form onSubmit={(e) => e.preventDefault()}>
            <ElementInput
              name="search"
              placeholder="Search by author, source, or text"
              startIcon={<Search size={15} />}
              clearable
              classNames={{ root: 'w-full md:w-72' }}
            />
          </form>
        </FormProvider>
      </ElementFilterBar>
    </div>
  )

  return (
    <SettingsShell description="Genuine customer reviews. Published rows render on the site and are the only source for the business's star rating in search results.">
      <div className="flex flex-col gap-4">
        {/* Not decoration. The rating markup these rows feed is a factual claim
            published in machine-readable form, and the person entering them is
            usually not the person who understands what that means. */}
        <div className="flex gap-3 rounded-lg border border-warning/50 bg-warning-light/40 p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden />
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-semibold">Every review here must be one a real customer actually left.</p>
            <p className="text-muted-foreground">
              Published reviews render on the site <em>and</em> feed the business&apos;s{' '}
              <code>AggregateRating</code> structured data, which is what produces the star rating Google
              can show beside the site in search results. Inventing, embellishing, or padding reviews is
              structured-data spam — it risks a Google manual action, and publishing a rating the business
              has not earned is a misrepresentation under the Competition Act. Record where each one came
              from in the <strong>Source</strong> field; that field is what makes the markup defensible if
              it is ever questioned.
            </p>
            <p className="text-muted-foreground">
              The average rating is always computed from these rows — there is deliberately no field to
              type one in by hand. The markup stays off entirely until{' '}
              {AGGREGATE_RATING_MIN_REVIEWS} reviews are published (
              {publishedCount} published now).
            </p>
          </div>
        </div>

        <BusinessReviewCreateDrawer
          isOpen={isCreateOpen}
          setIsOpen={setIsCreateOpen}
          onCreated={invalidate}
        />

        <BusinessReviewEditDrawer
          isOpen={editTarget !== null}
          setIsOpen={(open) => { if (!open) setEditTarget(null) }}
          review={editTarget}
          onUpdated={invalidate}
        />

        <ElementModal.Confirm
          isOpen={publishTarget !== null}
          onClose={(v) => { if (!v) setPublishTarget(null) }}
          variant="default"
          title={publishTarget?.isPublished ? 'Unpublish Review' : 'Publish Review'}
          description={
            publishTarget
              ? publishTarget.isPublished
                ? `Unpublish the review from "${publishTarget.authorName}"? It stops rendering on the site and no longer counts towards the star rating.`
                : `Publish the review from "${publishTarget.authorName}"? Confirm first that this is a real review from a real customer — publishing it makes it part of the rating the site claims in search results.`
              : undefined
          }
          confirmText="Confirm"
          cancelText="Cancel"
          isLoading={actionLoading}
          onConfirm={handleConfirmTogglePublished}
        />

        <ElementModal.Confirm
          isOpen={deleteTarget !== null}
          onClose={(v) => { if (!v) setDeleteTarget(null) }}
          variant="danger"
          title="Delete Review"
          description={
            deleteTarget
              ? `Delete the review from "${deleteTarget.authorName}"? It is removed from the site and from the rating average. This action cannot be undone.`
              : undefined
          }
          confirmText="Delete"
          cancelText="Cancel"
          isLoading={actionLoading}
          onConfirm={handleConfirmDelete}
        />

        <ElementTable<BusinessReview>
          columns={columns}
          data={reviews}
          loading={isLoading}
          loadingRows={5}
          headerContent={header}
          emptyContent={<p>No reviews yet. Add one only when a real customer has left it.</p>}
        />
      </div>
    </SettingsShell>
  )
}
