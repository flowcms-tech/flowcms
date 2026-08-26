import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import ElementTableButton from '@/components/shared/ElementTable/TableActionsButton/ElementTableButton'

export interface FaqRow extends Record<string, unknown> {
  id: string
  question: string
  answer: string
}

/** Generic over FaqRow so the same columns work for server-backed
 *  BlogPostFaq rows (Edit) and locally-staged BlogPostFaqDraft rows (Create,
 *  before the post exists). */
export function buildFaqColumns<TFaq extends FaqRow>(
  onEdit: (row: TFaq) => void,
  onDelete: (row: TFaq) => void,
): ExtendedColumnDef<TFaq>[] {
  return [
    {
      id: 'question',
      accessorKey: 'question',
      header: 'Question',
      cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span>,
    },
    {
      id: 'answer',
      accessorKey: 'answer',
      header: 'Answer',
      cell: ({ getValue }) => (
        <span className="line-clamp-2 text-sm text-muted-foreground">{getValue() as string}</span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <ElementTableButton.edit title="Edit" onClick={() => onEdit(row.original)} />
          <ElementTableButton.delete title="Delete" onClick={() => onDelete(row.original)} />
        </div>
      ),
    },
  ]
}
