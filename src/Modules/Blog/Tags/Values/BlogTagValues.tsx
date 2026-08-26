import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementTableButton from '@/components/shared/ElementTable/TableActionsButton/ElementTableButton'
import type { BlogTag } from '../Types'

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Shared by the create and edit drawers so the two never drift apart. The
 *  `isActive` contrast is spelled out because conflating the two flags is the
 *  obvious misreading: one hides the archive from Google, the other from
 *  visitors. */
export const INDEXABLE_HINT =
  'Leave on so Google can index this tag archive. Turning it off adds a noindex tag and drops the archive from the sitemap — the page stays publicly reachable and still lists its posts. To hide it from the site altogether, deactivate it instead.'

export const ARCHIVE_INTRO_HINT =
  'Rendered above the post grid, on page 1 only. An archive with just a heading and a grid of links is a list Google has no reason to rank; around 150 words of genuine copy about the topic makes it a page worth ranking. Plain text — HTML is not interpreted.'

function ActiveCell({ isActive }: { isActive: boolean }) {
  return (
    <ElementBadge variant={isActive ? 'success' : 'destructive'}>
      {isActive ? 'Active' : 'Inactive'}
    </ElementBadge>
  )
}

/**
 * Post count plus the *effective* search status, in one cell.
 *
 * The effective status is not just the `isIndexable` flag: an archive with zero
 * published indexable posts is noindexed and dropped from the sitemap whatever
 * the flag says. That rule is computed at render on the public side, so without
 * showing it here it would be invisible to the person who can fix it — and tag
 * archives are where thin indexed pages come from in the first place.
 */
function IndexingCell({ tag }: { tag: BlogTag }) {
  const { postCount, indexablePostCount, isIndexable } = tag

  let status: { variant: 'success' | 'warning' | 'muted'; label: string }
  if (!isIndexable) {
    status = { variant: 'muted', label: 'Noindex — hidden from search' }
  } else if (postCount === 0) {
    status = { variant: 'warning', label: 'Empty — will not be indexed' }
  } else if (indexablePostCount === 0) {
    status = { variant: 'warning', label: 'No indexable posts — will not be indexed' }
  } else {
    status = { variant: 'success', label: 'Indexable' }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <span className="text-sm">{postCount === 1 ? '1 post' : `${postCount} posts`}</span>
      <ElementBadge variant={status.variant} className="normal-case">
        {status.label}
      </ElementBadge>
    </div>
  )
}

export function buildColumns(
  onEdit: (row: BlogTag) => void,
  onToggleActive: (row: BlogTag) => void,
  onDelete: (row: BlogTag) => void,
): ExtendedColumnDef<BlogTag>[] {
  return [
    {
      id: 'name',
      accessorKey: 'name',
      header: 'Name',
      cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span>,
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
      header: 'Posts / Search',
      cell: ({ row }) => <IndexingCell tag={row.original} />,
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
