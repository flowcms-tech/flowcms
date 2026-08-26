import Link from 'next/link'
import { format } from 'date-fns'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import {
  ACTIVITY_ACTION_LABELS,
  ACTIVITY_ACTION_VARIANTS,
  ACTIVITY_ENTITY_LABELS,
  activityEntityHref,
} from '@/Framework/Activity/activityTypes'
import type { ActivityEntry } from '../Types'

export function ActionBadge({ action }: { action: ActivityEntry['action'] }) {
  return (
    <ElementBadge variant={ACTIVITY_ACTION_VARIANTS[action]}>
      {ACTIVITY_ACTION_LABELS[action]}
    </ElementBadge>
  )
}

/**
 * Read-only columns — there is no row action, and that is the point: an audit
 * trail with an edit button is not one.
 *
 * Column order follows how the row is read aloud: when, who, what happened, to
 * what. The summary is last because it is the only variable-width cell.
 */
/** `adminHref` is passed in rather than hooked: this is a column factory, not
 *  a component. */
export function buildColumns(adminHref: (sub?: string) => string): ExtendedColumnDef<ActivityEntry>[] {
  return [
    {
      id: 'createdAt',
      accessorKey: 'createdAt',
      header: 'When',
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="text-sm">{format(new Date(row.original.createdAt), 'MMM d, yyyy')}</span>
          <span className="text-xs text-muted-foreground">
            {format(new Date(row.original.createdAt), 'HH:mm')}
          </span>
        </div>
      ),
    },
    {
      id: 'actorName',
      accessorKey: 'actorName',
      header: 'Who',
      cell: ({ row }) => <span className="text-sm">{row.original.actorName}</span>,
    },
    {
      id: 'action',
      accessorKey: 'action',
      header: 'Action',
      cell: ({ row }) => <ActionBadge action={row.original.action} />,
    },
    {
      id: 'entity',
      header: 'What',
      cell: ({ row }) => {
        const relativeHref = activityEntityHref(row.original.entityType, row.original.entityId)
        const href = relativeHref ? adminHref(relativeHref) : null
        return (
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {ACTIVITY_ENTITY_LABELS[row.original.entityType]}
            </span>
            {/* Deleted subjects render as plain text — see activityEntityHref:
                a link to something that no longer exists is worse than none. */}
            {href ? (
              <Link href={href} className="max-w-[22rem] truncate font-medium hover:underline">
                {row.original.entityLabel}
              </Link>
            ) : (
              <span className="max-w-[22rem] truncate font-medium">{row.original.entityLabel}</span>
            )}
          </div>
        )
      },
    },
    {
      id: 'summary',
      header: 'Details',
      cell: ({ row }) => (
        <span className="block max-w-[28rem] whitespace-normal text-sm text-muted-foreground">
          {row.original.summary || '—'}
        </span>
      ),
    },
  ]
}
