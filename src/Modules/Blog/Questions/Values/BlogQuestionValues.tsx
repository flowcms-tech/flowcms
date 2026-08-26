import Link from 'next/link'
import { format } from 'date-fns'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementTableButton from '@/components/shared/ElementTable/TableActionsButton/ElementTableButton'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import { QUESTION_STATUS_LABELS, type QuestionStatus } from './Validations'
import type { BlogQuestion } from '../Types'

const STATUS_VARIANTS: Record<QuestionStatus, 'info' | 'success' | 'muted'> = {
  pending: 'info',
  published: 'success',
  rejected: 'muted',
}

export function QuestionStatusBadge({ status }: { status: QuestionStatus }) {
  return <ElementBadge variant={STATUS_VARIANTS[status]}>{QUESTION_STATUS_LABELS[status]}</ElementBadge>
}

export function buildColumns(
  onAnswer: (row: BlogQuestion) => void,
  onDelete: (row: BlogQuestion) => void,
  /** Builds admin URLs under the configured public admin path. Passed in
   *  rather than hooked: this is a column factory, not a component. */
  adminHref: (sub?: string) => string,
): ExtendedColumnDef<BlogQuestion>[] {
  return [
    {
      id: 'question',
      accessorKey: 'question',
      header: 'Question',
      cell: ({ row }) => (
        <div className="flex max-w-md flex-col">
          <span className="line-clamp-2 font-medium">{row.original.question}</span>
          <span className="text-xs text-muted-foreground">
            {row.original.askerName ? `Asked by ${row.original.askerName}` : 'Asked anonymously'}
            {' · '}
            {format(new Date(row.original.createdAt), 'MMM d, yyyy')}
          </span>
        </div>
      ),
    },
    {
      id: 'post',
      header: 'On post',
      cell: ({ row }) =>
        row.original.post ? (
          <Link
            href={adminHref(`/blog/posts/${row.original.post.id}/edit`)}
            className="text-sm hover:underline"
          >
            {row.original.post.title}
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      id: 'answer',
      header: 'Answer',
      cell: ({ row }) => (
        <span className="line-clamp-2 max-w-xs text-sm text-muted-foreground">
          {row.original.answer || 'Not answered yet'}
        </span>
      ),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => <QuestionStatusBadge status={getValue() as QuestionStatus} />,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <ElementButton variant="outline" size="sm" onClick={() => onAnswer(row.original)}>
            {row.original.answer ? 'Edit answer' : 'Answer'}
          </ElementButton>
          <ElementTableButton.delete title="Delete" onClick={() => onDelete(row.original)} />
        </div>
      ),
    },
  ]
}
