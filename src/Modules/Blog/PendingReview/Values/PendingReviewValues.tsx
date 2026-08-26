import Link from 'next/link'
import { format } from 'date-fns'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import { REVIEW_STATUS_LABELS, type ReviewStatus } from '@/Modules/Blog/Posts/Values/reviewWorkflow'
import type { PendingReviewPost } from '../Types'

const STATUS_VARIANTS: Record<ReviewStatus, 'muted' | 'info' | 'success' | 'warning'> = {
  none: 'muted',
  pending: 'info',
  approved: 'success',
  rejected: 'warning',
}

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  return <ElementBadge variant={STATUS_VARIANTS[status]}>{REVIEW_STATUS_LABELS[status]}</ElementBadge>
}

export function buildColumns(
  onApprove: (row: PendingReviewPost) => void,
  onReject: (row: PendingReviewPost) => void,
  /** The signed-in editor. Reviewing your own submission is refused by the
   *  route, so the buttons come off rather than producing a 422 on click. */
  currentUserId: string,
  /** Builds admin URLs under the configured public admin path. Passed in
   *  rather than hooked: this is a column factory, not a component. */
  adminHref: (sub?: string) => string,
): ExtendedColumnDef<PendingReviewPost>[] {
  return [
    {
      id: 'title',
      accessorKey: 'title',
      header: 'Post',
      cell: ({ row }) => (
        <div className="flex flex-col">
          <Link
            href={adminHref(`/blog/posts/${row.original.id}/edit`)}
            className="font-medium hover:underline"
          >
            {row.original.title}
          </Link>
          <span className="line-clamp-1 text-xs text-muted-foreground">{row.original.excerpt}</span>
        </div>
      ),
    },
    {
      id: 'createdBy',
      header: 'Submitted by',
      cell: ({ row }) => (
        <span className="text-sm">{row.original.createdBy.name || '—'}</span>
      ),
    },
    {
      id: 'wordCount',
      header: 'Length',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.wordCount ? `${row.original.wordCount} words` : '—'}
        </span>
      ),
    },
    {
      id: 'reviewStatus',
      accessorKey: 'reviewStatus',
      header: 'Status',
      cell: ({ getValue }) => <ReviewStatusBadge status={getValue() as ReviewStatus} />,
    },
    {
      id: 'reviewedAt',
      accessorKey: 'reviewedAt',
      header: 'Decided',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.reviewedAt ? format(new Date(row.original.reviewedAt), 'MMM d, yyyy') : '—'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const isOwnPost = row.original.createdBy.id === currentUserId
        if (isOwnPost) {
          return (
            <span className="block text-right text-xs text-muted-foreground">
              Your own post
            </span>
          )
        }
        return (
          <div className="flex items-center justify-end gap-1">
            <ElementButton variant="outline" size="sm" onClick={() => onReject(row.original)}>
              Request changes
            </ElementButton>
            <ElementButton size="sm" onClick={() => onApprove(row.original)}>
              Approve
            </ElementButton>
          </div>
        )
      },
    },
  ]
}
