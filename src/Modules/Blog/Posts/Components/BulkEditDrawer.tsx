'use client'

import { useState } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import BAPI from '@/Framework/API_Layer'
import ElementDrawer, { ElementDrawerFooter } from '@/components/shared/ElementDrawer/ElementDrawer'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementSelect from '@/components/shared/ElementSelect/ElementSelect'
import ValidationBox from '@/components/shared/Validations/ValidationBox'
import { BlogCategoryServices } from '@/Modules/Blog/Categories/Services/BlogCategoryServices'
import { BlogTagServices } from '@/Modules/Blog/Tags/Services/BlogTagServices'
import { BlogSeriesServices } from '@/Modules/Blog/Series/Services/BlogSeriesServices'
import { buildParentOptions } from '@/Modules/Blog/Categories/Values/BlogCategoryValues'
import { SCHEMA_TYPES } from '../Values/Validations'
import type { BlogPost } from '../Types'

interface ApiResponse<T> { data: T; message: string | string[] }

/** Matches the route's own cap. Enforced here too so 400 selected rows fail in
 *  the drawer with an explanation rather than as a 422 from the server. */
const MAX_BULK_ROWS = 100

/** Booleans need three states in a bulk form: set true, set false, and the
 *  default — leave every row exactly as it is. A checkbox only has two, and
 *  "unchecked" silently meaning "set false on 40 posts" is how bulk edit earns
 *  its reputation. */
const TRISTATE_ITEMS = [
  { label: 'Leave unchanged', value: 'leave' },
  { label: 'Yes', value: 'true' },
  { label: 'No', value: 'false' },
]

interface BulkForm {
  isIndexable: string
  isCornerstone: string
  primaryCategoryId: string
  addCategoryIds: string[]
  removeCategoryIds: string[]
  addTagIds: string[]
  removeTagIds: string[]
  focusKeyword: string
  schemaType: string
  seriesId: string
}

const EMPTY_FORM: BulkForm = {
  isIndexable: 'leave',
  isCornerstone: 'leave',
  primaryCategoryId: '',
  addCategoryIds: [],
  removeCategoryIds: [],
  addTagIds: [],
  removeTagIds: [],
  focusKeyword: '',
  schemaType: '',
  seriesId: '',
}

export interface BulkUpdateResult {
  id: string
  ok: boolean
  message?: string
}

/**
 * Kept local rather than calling `BlogPostServices.bulkUpdate`: the service
 * types `changes` as a closed `BulkPostChanges`, while this drawer builds a
 * sparse object from tri-state controls where "leave unchanged" means the key
 * is absent. Narrowing to the closed type here would either need a cast or a
 * second mapping layer, and the route already rejects unknown keys with a 422
 * (`z.strictObject`) — which is the check that actually matters.
 */
async function bulkUpdate(ids: string[], changes: Record<string, unknown>): Promise<BulkUpdateResult[]> {
  const res = await BAPI.patch<ApiResponse<BulkUpdateResult[]>>(
    '/api/blog/posts/bulk',
    { ids, changes },
    { showGlobalError: false, showGlobalSuccess: true }
  )
  return res.data
}

interface BulkEditDrawerProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  rows: BlogPost[]
  onApplied: () => void
}

export default function BulkEditDrawer({ isOpen, setIsOpen, rows, onApplied }: BulkEditDrawerProps) {
  const queryClient = useQueryClient()
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [failures, setFailures] = useState<BulkUpdateResult[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const methods = useForm<BulkForm>({ defaultValues: EMPTY_FORM })
  const { handleSubmit, reset } = methods

  const { data: categories } = useQuery({
    queryKey: ['blog-categories-list', ''],
    queryFn: () => BlogCategoryServices.list(),
    enabled: isOpen,
  })
  const { data: tags } = useQuery({
    queryKey: ['blog-tags-list', ''],
    queryFn: () => BlogTagServices.list(),
    enabled: isOpen,
  })
  const { data: series } = useQuery({
    queryKey: ['blog-series-list', ''],
    queryFn: () => BlogSeriesServices.list(),
    enabled: isOpen,
  })

  /** Cleared on the way out rather than in an effect watching `isOpen`, which
   *  would be a setState cascade on every open/close. Same shape as the other
   *  create drawers in the app. */
  function handleClose(open: boolean) {
    if (!open) {
      reset(EMPTY_FORM)
      setServerErrors([])
      setFailures([])
    }
    setIsOpen(open)
  }

  const categoryOptions = buildParentOptions(categories ?? [])
  const tagOptions = (tags ?? []).map((tag) => ({ label: tag.name, value: tag.id }))
  const seriesOptions = (series ?? []).map((entry) => ({ label: entry.name, value: entry.id }))
  const overCap = rows.length > MAX_BULK_ROWS

  function buildChanges(values: BulkForm): Record<string, unknown> {
    const changes: Record<string, unknown> = {}
    if (values.isIndexable !== 'leave') changes.isIndexable = values.isIndexable === 'true'
    if (values.isCornerstone !== 'leave') changes.isCornerstone = values.isCornerstone === 'true'
    if (values.primaryCategoryId) changes.primaryCategoryId = values.primaryCategoryId
    if (values.addCategoryIds?.length) changes.addCategoryIds = values.addCategoryIds
    if (values.removeCategoryIds?.length) changes.removeCategoryIds = values.removeCategoryIds
    if (values.addTagIds?.length) changes.addTagIds = values.addTagIds
    if (values.removeTagIds?.length) changes.removeTagIds = values.removeTagIds
    if (values.focusKeyword?.trim()) changes.focusKeyword = values.focusKeyword.trim()
    if (values.schemaType) changes.schemaType = values.schemaType
    if (values.seriesId) changes.seriesId = values.seriesId
    return changes
  }

  const onSubmit = async (values: BulkForm) => {
    setServerErrors([])
    setFailures([])

    const changes = buildChanges(values)
    if (Object.keys(changes).length === 0) {
      setServerErrors(['Nothing to apply — every field is still set to leave unchanged.'])
      return
    }

    setIsSubmitting(true)
    try {
      const results = await bulkUpdate(rows.map((row) => row.id), changes)
      // Per-id results, so a partial failure is legible instead of one red toast
      // that tells the editor nothing about which 3 of 40 rows did not take.
      const failed = (results ?? []).filter((result) => !result.ok)
      setFailures(failed)
      await queryClient.invalidateQueries({ queryKey: ['blog-posts-list'] })
      if (failed.length === 0) {
        onApplied()
        handleClose(false)
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { message?: string | string[] } } }
      if (axiosErr.response?.status === 422) {
        const raw = axiosErr.response.data?.message
        setServerErrors(Array.isArray(raw) ? raw : raw ? [raw] : ['An error occurred'])
      } else {
        setServerErrors(['An error occurred'])
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <ElementDrawer
      isOpen={isOpen}
      setIsOpen={handleClose}
      headerLabel={`Bulk edit ${rows.length} post${rows.length === 1 ? '' : 's'}`}
      direction="left"
      size="md"
      footer={
        <ElementDrawerFooter>
          <ElementButton variant="cancel" onClick={() => handleClose(false)} disabled={isSubmitting}>
            Cancel
          </ElementButton>
          <ElementButton onClick={handleSubmit(onSubmit)} isLoading={isSubmitting} disabled={overCap}>
            Apply to {rows.length}
          </ElementButton>
        </ElementDrawerFooter>
      }
    >
      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <ValidationBox messages={serverErrors} />

          {overCap && (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {rows.length} rows selected. Bulk edit is capped at {MAX_BULK_ROWS} per run so one
              mistake cannot rewrite the whole blog in a single transaction. Narrow the
              selection and run it again.
            </p>
          )}

          <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-snug text-muted-foreground">
            Only fields you change are sent. Everything left on{' '}
            <span className="font-medium text-foreground">Leave unchanged</span> or blank is not
            touched on any of the selected posts.
          </p>

          {/* The omission is deliberate and worth explaining where someone would
              otherwise go looking for it. */}
          <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-snug text-muted-foreground">
            <span className="font-medium text-foreground">
              Meta title and description are deliberately not here.
            </span>{' '}
            Pasting one description onto forty posts creates exactly the duplicate-content
            problem the field exists to prevent. Fix those per post, or set a site-wide meta
            template under Settings → SEO and leave them blank.
          </p>

          <ElementSelect
            name="isIndexable"
            label="Allow search engines to index"
            items={TRISTATE_ITEMS}
            hint="Set to No to noindex every selected post and drop it from the sitemap."
          />

          <ElementSelect
            name="isCornerstone"
            label="Cornerstone content"
            items={TRISTATE_ITEMS}
            hint="Pillar posts. They rank higher in related-post scoring and head up the cluster view."
          />

          <ElementSelect
            name="primaryCategoryId"
            label="Primary category"
            placeholder="Leave unchanged"
            items={categoryOptions}
            clearable
            hint="Drives the breadcrumb trail and articleSection. The server rejects a primary category a post is not actually in."
          />

          <div className="grid grid-cols-2 gap-4">
            <ElementSelect
              name="addCategoryIds"
              label="Add categories"
              placeholder="None"
              items={categoryOptions}
              multiple
              clearable
            />
            <ElementSelect
              name="removeCategoryIds"
              label="Remove categories"
              placeholder="None"
              items={categoryOptions}
              multiple
              clearable
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <ElementSelect
              name="addTagIds"
              label="Add tags"
              placeholder="None"
              items={tagOptions}
              multiple
              clearable
            />
            <ElementSelect
              name="removeTagIds"
              label="Remove tags"
              placeholder="None"
              items={tagOptions}
              multiple
              clearable
            />
          </div>

          <ElementInput
            name="focusKeyword"
            label="Focus keyword"
            placeholder="Leave blank to keep each post's own"
            hint="Only useful when the selected posts genuinely target the same query — otherwise set it per post."
            maxLength={100}
          />

          <ElementSelect
            name="schemaType"
            label="Schema type"
            placeholder="Leave unchanged"
            items={SCHEMA_TYPES.map((type) => ({ label: type, value: type }))}
            clearable
            hint="Switching to HowTo, Review or VideoObject in bulk leaves each post without the payload that type needs — set those individually."
          />

          <ElementSelect
            name="seriesId"
            label="Series"
            placeholder="Leave unchanged"
            items={seriesOptions}
            clearable
            hint="Positions within the series are not set here — a bulk-assigned order would be arbitrary."
          />

          {failures.length > 0 && (
            <div className="flex flex-col gap-1 rounded-lg border border-warning/40 bg-warning-light/40 p-3 text-xs">
              <p className="font-medium">{failures.length} post(s) were not updated:</p>
              <ul className="flex flex-col gap-0.5">
                {failures.map((failure) => (
                  <li key={failure.id} className="text-muted-foreground">
                    {rows.find((row) => row.id === failure.id)?.title ?? failure.id} —{' '}
                    {failure.message ?? 'rejected'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </form>
      </FormProvider>
    </ElementDrawer>
  )
}
