import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementTableButton from '@/components/shared/ElementTable/TableActionsButton/ElementTableButton'
import { parseDate } from '@/Framework/Functions/DateFunctions'
import type { Redirect } from '../Types'

export function buildColumns(
  onEdit: (row: Redirect) => void,
  onDelete: (row: Redirect) => void,
): ExtendedColumnDef<Redirect>[] {
  return [
    {
      id: 'fromPath',
      accessorKey: 'fromPath',
      header: 'From',
      cell: ({ getValue }) => (
        <span className="font-mono text-sm font-medium">{getValue() as string}</span>
      ),
    },
    {
      id: 'toPath',
      accessorKey: 'toPath',
      header: 'To',
      cell: ({ getValue }) => (
        <span className="font-mono text-sm text-muted-foreground">{getValue() as string}</span>
      ),
    },
    {
      id: 'statusCode',
      header: 'Type',
      cell: ({ row }) => (
        <ElementBadge variant={row.original.statusCode === 301 ? 'success' : 'warning'}>
          {row.original.statusCode === 301 ? 'Permanent (301)' : 'Temporary (302)'}
        </ElementBadge>
      ),
    },
    {
      id: 'isAutomatic',
      header: 'Source',
      cell: ({ row }) => (
        <ElementBadge variant={row.original.isAutomatic ? 'muted' : 'info'}>
          {row.original.isAutomatic ? 'Automatic' : 'Manual'}
        </ElementBadge>
      ),
    },
    {
      id: 'createdAt',
      header: 'Created',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {parseDate(row.original.createdAt).toDate()}
        </span>
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
