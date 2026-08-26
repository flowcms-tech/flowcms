import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementTableButton from '@/components/shared/ElementTable/TableActionsButton/ElementTableButton'
import { ROLE_LABELS, type Role } from '@/Framework/Auth/permissions'
import type { AdminUser } from '../Types'

function ActiveCell({ isActive }: { isActive: boolean }) {
  return (
    <ElementBadge variant={isActive ? 'success' : 'destructive'}>
      {isActive ? 'Active' : 'Inactive'}
    </ElementBadge>
  )
}

/** Owner is visually distinct because it is the one role with rules attached to
 *  it — you cannot demote it from here, and the badge is the first hint of why
 *  the action might be refused. */
const ROLE_VARIANTS: Record<Role, 'default' | 'info' | 'secondary' | 'muted'> = {
  owner: 'default',
  admin: 'info',
  editor: 'secondary',
  contributor: 'muted',
}

function RoleCell({ role }: { role: Role }) {
  return <ElementBadge variant={ROLE_VARIANTS[role]}>{ROLE_LABELS[role]}</ElementBadge>
}

export function buildColumns(
  startIndex: number,
  onEdit: (row: AdminUser) => void,
  onToggleActive: (row: AdminUser) => void,
  onDelete: (row: AdminUser) => void,
): ExtendedColumnDef<AdminUser>[] {
  return [
    {
      id: 'rowNumber',
      header: '#',
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">{startIndex + row.index + 1}</span>
      ),
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: 'Name',
      cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span>,
    },
    {
      id: 'email',
      accessorKey: 'email',
      header: 'Email',
      cell: ({ getValue }) => <span className="text-sm">{getValue() as string}</span>,
    },
    {
      id: 'role',
      accessorKey: 'role',
      header: 'Role',
      cell: ({ getValue }) => <RoleCell role={getValue() as Role} />,
    },
    {
      id: 'isActive',
      accessorKey: 'isActive',
      header: 'Status',
      cell: ({ getValue }) => <ActiveCell isActive={getValue() as boolean} />,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <ElementButton
            variant="outline"
            size="sm"
            onClick={() => onToggleActive(row.original)}
          >
            {row.original.isActive ? 'Deactivate' : 'Activate'}
          </ElementButton>
          <ElementTableButton.edit title="Edit" onClick={() => onEdit(row.original)} />
          <ElementTableButton.delete title="Delete" onClick={() => onDelete(row.original)} />
        </div>
      ),
    },
  ]
}
