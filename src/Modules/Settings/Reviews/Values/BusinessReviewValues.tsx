import { format } from 'date-fns'
import { Star } from 'lucide-react'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementTableButton from '@/components/shared/ElementTable/TableActionsButton/ElementTableButton'
import type { BusinessReview } from '../Types'

/** Google emits AggregateRating only once there is a real body of reviews
 *  behind it. Mirrored in the public JSON-LD builder — this constant exists
 *  so the admin can see how far off the gate it is, not to re-implement it. */
export const AGGREGATE_RATING_MIN_REVIEWS = 3

export const RATING_ITEMS = [
  { label: '5 — Excellent', value: '5' },
  { label: '4 — Good', value: '4' },
  { label: '3 — Average', value: '3' },
  { label: '2 — Poor', value: '2' },
  { label: '1 — Very poor', value: '1' },
]

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={13}
          aria-hidden
          className={n <= rating ? 'fill-warning text-warning' : 'text-muted-foreground/40'}
        />
      ))}
    </span>
  )
}

export function buildColumns(
  onEdit: (row: BusinessReview) => void,
  onTogglePublished: (row: BusinessReview) => void,
  onDelete: (row: BusinessReview) => void,
): ExtendedColumnDef<BusinessReview>[] {
  return [
    {
      id: 'authorName',
      accessorKey: 'authorName',
      header: 'Author',
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.authorName}</span>
          {row.original.body && (
            <span className="line-clamp-1 max-w-[24rem] text-xs text-muted-foreground">{row.original.body}</span>
          )}
        </div>
      ),
    },
    {
      id: 'rating',
      accessorKey: 'rating',
      header: 'Rating',
      cell: ({ getValue }) => <Stars rating={getValue() as number} />,
    },
    {
      id: 'source',
      accessorKey: 'source',
      header: 'Source',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.sourceUrl ? (
            <a
              href={row.original.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              {row.original.source}
            </a>
          ) : (
            row.original.source
          )}
        </span>
      ),
    },
    {
      id: 'reviewedAt',
      accessorKey: 'reviewedAt',
      header: 'Reviewed',
      cell: ({ getValue }) => {
        const value = getValue() as string | null
        return (
          <span className="text-sm text-muted-foreground">
            {value ? format(new Date(value), 'MMM d, yyyy') : '—'}
          </span>
        )
      },
    },
    {
      id: 'isPublished',
      accessorKey: 'isPublished',
      header: 'Status',
      cell: ({ getValue }) => (
        <ElementBadge variant={(getValue() as boolean) ? 'success' : 'muted'}>
          {(getValue() as boolean) ? 'Published' : 'Unpublished'}
        </ElementBadge>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <ElementButton variant="outline" size="sm" onClick={() => onTogglePublished(row.original)}>
            {row.original.isPublished ? 'Unpublish' : 'Publish'}
          </ElementButton>
          <ElementTableButton.edit title="Edit" onClick={() => onEdit(row.original)} />
          <ElementTableButton.delete title="Delete" onClick={() => onDelete(row.original)} />
        </div>
      ),
    },
  ]
}
