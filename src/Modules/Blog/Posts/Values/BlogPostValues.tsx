'use client'

import { Lock, ArrowRightLeft, Gem } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useFormContext, type FieldValues } from 'react-hook-form'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import { parseDate } from '@/Framework/Functions/DateFunctions'
import BlogPostActionsMenu from '../Components/BlogPostActionsMenu'
import type { BlogPost } from '../Types'

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Strips the rich-text HTML from the content editor down to plain text, then
 *  trims to a clean ~160-character boundary (cuts at the last whole word) for
 *  the auto-fill-until-touched excerpt field in the create drawer. */
export function suggestExcerpt(content: string): string {
  const plainText = content
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (plainText.length <= 160) return plainText
  const cut = plainText.slice(0, 160)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()}…`
}

function StatusCell({ isPublished, scheduledPublishAt }: { isPublished: boolean; scheduledPublishAt: string | null }) {
  if (isPublished) {
    return <ElementBadge variant="success">Published</ElementBadge>
  }
  if (scheduledPublishAt) {
    return (
      <ElementBadge variant="warning">
        Scheduled for {parseDate(scheduledPublishAt).toDate()}
      </ElementBadge>
    )
  }
  return <ElementBadge variant="info">Draft</ElementBadge>
}

/**
 * The stored score, colour-banded.
 *
 * `seoScore` is written by the analyser on save, so a post nobody has saved
 * since the column landed shows "—" rather than a misleading zero. The edit
 * screen re-runs the analyser live; this column exists so the list can be
 * scanned and sorted without parsing every post's HTML.
 */
function SeoScoreCell({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return <span className="text-sm text-muted-foreground" title="Not scored yet — save the post to score it">—</span>
  }
  const tone =
    score >= 80
      ? 'bg-success-light text-success'
      : score >= 50
        ? 'bg-warning-light text-warning'
        : 'bg-destructive/10 text-destructive'
  return (
    <span className={`inline-flex min-w-9 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {score}
    </span>
  )
}

/**
 * Radio-style primary picker sitting beside the selected category chips.
 *
 * Lives here rather than in the post form because both the create and the edit
 * module need it and neither owns the other. Two rules it enforces so the
 * server never has to reject the form: the choice is always one of the
 * currently-selected categories, and it defaults to the first selected rather
 * than to nothing (a post with categories and no primary produces an arbitrary
 * breadcrumb, which is the bug this field exists to remove).
 */
export function PrimaryCategoryPicker({
  categories,
  disabled,
}: {
  categories: { id: string; name: string }[]
  disabled?: boolean
}) {
  const { watch, setValue } = useFormContext<FieldValues>()
  const selectedIds: string[] = watch('categoryIds') ?? []
  const primaryId: string | undefined = watch('primaryCategoryId')

  const nameById = new Map(categories.map((category) => [category.id, category.name]))
  const selected = selectedIds.filter((id) => nameById.has(id))

  // Keeps the primary inside `categoryIds` at all times — deselecting the
  // primary category re-points it at the first remaining one rather than
  // leaving a value the Zod cross-field rule will reject at submit.
  useEffect(() => {
    if (selected.length === 0) {
      if (primaryId) setValue('primaryCategoryId', '', { shouldValidate: false })
      return
    }
    if (!primaryId || !selected.includes(primaryId)) {
      setValue('primaryCategoryId', selected[0], { shouldValidate: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.join(','), primaryId])

  if (selected.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Pick a category above and the first one becomes the primary automatically.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium leading-none">Primary Category</span>
      <div className="flex flex-wrap gap-2">
        {selected.map((id) => {
          const isPrimary = id === primaryId
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => setValue('primaryCategoryId', id, { shouldValidate: true, shouldDirty: true })}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                isPrimary
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <span
                className={`size-2.5 rounded-full border ${isPrimary ? 'border-primary bg-primary' : 'border-muted-foreground'}`}
              />
              {nameById.get(id)}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Drives the breadcrumb trail and the article section in structured data. Without it the
        choice is whichever category the database returns first, which can change between
        deploys.
      </p>
    </div>
  )
}

/**
 * Numeric field that puts a real `number` into form state.
 *
 * `ElementInput` hands the resolver a string even at `type="number"`, and the
 * schemas that back these fields (`seriesPosition`, the Review rating trio) are
 * `z.number()` — a typed value would fail validation on a tab the editor may
 * not even have open. The local raw string is what lets "4.5" be typed at all:
 * pushing `Number("4.")` straight back into a controlled input eats the decimal
 * point as it is entered.
 */
export function NumberField({
  name,
  label,
  placeholder,
  hint,
  disabled,
  required,
}: {
  name: string
  label: string
  placeholder?: string
  hint?: string
  disabled?: boolean
  required?: boolean
}) {
  const { watch, setValue, formState } = useFormContext<FieldValues>()
  const committed = watch(name)
  const [raw, setRaw] = useState<string>(committed === undefined || committed === null ? '' : String(committed))
  const error = name
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], formState.errors) as
    | { message?: string }
    | undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium leading-none">
        {label}
        {required && <span className="mx-0.5 text-destructive">*</span>}
      </label>
      <input
        type="number"
        step="any"
        inputMode="decimal"
        value={raw}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => {
          setRaw(event.target.value)
          const next = event.target.value.trim()
          setValue(name, next === '' ? undefined : Number(next), { shouldValidate: true, shouldDirty: true })
        }}
        onBlur={() => setRaw(committed === undefined || committed === null ? '' : String(committed))}
        className={`h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-colors focus:border-primary disabled:opacity-50 ${
          error ? 'border-destructive' : 'border-input'
        }`}
      />
      {error?.message && <p className="text-sm text-destructive">{error.message}</p>}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export interface TrashActions {
  isTrashView: boolean
  onRestore: (row: BlogPost) => void
  onPurge: (row: BlogPost) => void
}

export function buildColumns(
  onEdit: (row: BlogPost) => void,
  onTogglePublished: (row: BlogPost) => void,
  onDelete: (row: BlogPost) => void,
  onRedirect: (row: BlogPost) => void,
  onDuplicate: (row: BlogPost) => void,
  trash?: TrashActions,
  /** Only used to keep the badge from firing on your own other tab —
   *  omitted entirely (not just falsy) means "don't know yet", so the badge
   *  stays hidden rather than briefly flashing on every row on first load. */
  currentUserId?: string,
): ExtendedColumnDef<BlogPost>[] {
  return [
    {
      id: 'title',
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => {
        const lockedByOther = row.original.lockedBy && row.original.lockedBy.id !== currentUserId
        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{row.original.title}</span>
              {row.original.isCornerstone && (
                <span
                  title="Cornerstone content — a pillar page other posts should link to"
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                >
                  <Gem size={10} />
                  Cornerstone
                </span>
              )}
              {lockedByOther && (
                <span
                  title={`Being edited by ${row.original.lockedBy?.name || 'another admin'}`}
                  className="inline-flex items-center gap-1 rounded-full bg-warning-light px-2 py-0.5 text-[11px] font-medium text-warning"
                >
                  <Lock size={10} />
                  {row.original.lockedBy?.name || 'Locked'}
                </span>
              )}
            </div>
            {row.original.redirectTo && (
              <span
                title={`This post's URL redirects to ${row.original.redirectTo}`}
                className="inline-flex w-fit items-center gap-1 rounded-full bg-info-light px-2 py-0.5 text-[11px] font-medium text-info"
              >
                <ArrowRightLeft size={10} />
                Redirects to {row.original.redirectTo}
              </span>
            )}
          </div>
        )
      },
    },
    {
      id: 'categories',
      header: 'Categories',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.categories.length > 0 ? row.original.categories.map((c) => c.name).join(', ') : '—'}
        </span>
      ),
    },
    {
      id: 'seoScore',
      accessorKey: 'seoScore',
      header: 'SEO',
      sort: true,
      cell: ({ row }) => <SeoScoreCell score={row.original.seoScore} />,
    },
    {
      id: 'isPublished',
      accessorKey: 'isPublished',
      header: 'Status',
      cell: ({ row }) => (
        <StatusCell isPublished={row.original.isPublished} scheduledPublishAt={row.original.scheduledPublishAt} />
      ),
    },
    {
      id: 'publishedAt',
      header: 'Published',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.publishedAt ? parseDate(row.original.publishedAt).toDate() : '—'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end">
          <BlogPostActionsMenu
            post={row.original}
            onEdit={onEdit}
            onTogglePublished={onTogglePublished}
            onDelete={onDelete}
            onRedirect={onRedirect}
            onDuplicate={onDuplicate}
            trash={trash}
          />
        </div>
      ),
    },
  ]
}
