import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementTableButton from '@/components/shared/ElementTable/TableActionsButton/ElementTableButton'
import type { BlogSeries } from '../Types'

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function buildColumns(
  onEdit: (row: BlogSeries) => void,
  onToggleActive: (row: BlogSeries) => void,
  onDelete: (row: BlogSeries) => void,
): ExtendedColumnDef<BlogSeries>[] {
  return [
    {
      id: 'name',
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.name}</span>
          {row.original.description && (
            <span className="line-clamp-1 text-xs text-muted-foreground">{row.original.description}</span>
          )}
        </div>
      ),
    },
    {
      id: 'slug',
      accessorKey: 'slug',
      header: 'Slug',
      cell: ({ getValue }) => <span className="text-sm text-muted-foreground">{getValue() as string}</span>,
    },
    {
      id: 'postCount',
      accessorKey: 'postCount',
      header: 'Parts',
      cell: ({ getValue }) => <span className="text-sm">{getValue() as number}</span>,
    },
    {
      id: 'isActive',
      accessorKey: 'isActive',
      header: 'Status',
      cell: ({ getValue }) => (
        <ElementBadge variant={(getValue() as boolean) ? 'success' : 'destructive'}>
          {(getValue() as boolean) ? 'Active' : 'Inactive'}
        </ElementBadge>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <ElementButton variant="outline" size="sm" onClick={() => onToggleActive(row.original)}>
            {row.original.isActive ? 'Deactivate' : 'Activate'}
          </ElementButton>
          <ElementTableButton.edit title="Edit" onClick={() => onEdit(row.original)} />
          <ElementTableButton.delete title="Delete" onClick={() => onDelete(row.original)} />
        </div>
      ),
    },
  ]
}
