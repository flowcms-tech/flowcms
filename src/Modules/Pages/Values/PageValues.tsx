import { ExternalLink } from 'lucide-react'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementTableButton from '@/components/shared/ElementTable/TableActionsButton/ElementTableButton'
import type { CustomPage } from '../Types'

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Auto-derives a single-segment path from the title. Nested paths
 *  (`/legal/terms`) are always a deliberate manual edit — the auto-derive
 *  case is only ever the common single-page one. */
export function pathFromTitle(title: string): string {
  const slug = slugify(title)
  return slug ? `/${slug}` : ''
}

export const INDEXABLE_HINT =
  'Leave on so Google can index this page. Turning it off adds a noindex tag and drops the page from the sitemap — it stays publicly reachable, just hidden from search. To take it off the site altogether, unpublish it instead.'

function StatusCell({ page }: { page: CustomPage }) {
  return (
    <ElementBadge variant={page.isPublished ? 'success' : 'muted'}>
      {page.isPublished ? 'Published' : 'Draft'}
    </ElementBadge>
  )
}

function PathCell({ page }: { page: CustomPage }) {
  return (
    <span className="flex items-center gap-1.5">
      <code className="text-sm text-muted-foreground">{page.path}</code>
      {page.isPublished && (
        <a
          href={page.path}
          target="_blank"
          rel="noreferrer"
          title="Open live page"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <ExternalLink size={13} />
        </a>
      )}
    </span>
  )
}

export function buildColumns(
  onEdit: (row: CustomPage) => void,
  onTogglePublished: (row: CustomPage) => void,
  onDelete: (row: CustomPage) => void,
): ExtendedColumnDef<CustomPage>[] {
  return [
    {
      id: 'title',
      accessorKey: 'title',
      header: 'Title',
      cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span>,
    },
    {
      id: 'path',
      accessorKey: 'path',
      header: 'Path',
      cell: ({ row }) => <PathCell page={row.original} />,
    },
    {
      id: 'isPublished',
      accessorKey: 'isPublished',
      header: 'Status',
      cell: ({ row }) => <StatusCell page={row.original} />,
    },
    {
      id: 'updatedAt',
      accessorKey: 'updatedAt',
      header: 'Updated',
      cell: ({ getValue }) => (
        <span className="text-sm text-muted-foreground">
          {new Date(getValue() as string).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <ElementButton
            variant="outline"
            size="sm"
            onClick={() => onTogglePublished(row.original)}
          >
            {row.original.isPublished ? 'Unpublish' : 'Publish'}
          </ElementButton>
          <ElementTableButton.edit title="Edit" onClick={() => onEdit(row.original)} />
          <ElementTableButton.delete title="Delete" onClick={() => onDelete(row.original)} />
        </div>
      ),
    },
  ]
}
