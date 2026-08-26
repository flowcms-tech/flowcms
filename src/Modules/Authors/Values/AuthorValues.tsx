import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementTableButton from '@/components/shared/ElementTable/TableActionsButton/ElementTableButton'
import type { Author } from '../Types'

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** The profile links that become schema.org `sameAs`. Blanks are skipped —
 *  an empty sameAs entry is worse than none. */
export function sameAsLinks(author: {
  websiteUrl?: string | null
  linkedinUrl?: string | null
  twitterUrl?: string | null
  facebookUrl?: string | null
  instagramUrl?: string | null
}): string[] {
  return [
    author.websiteUrl,
    author.linkedinUrl,
    author.twitterUrl,
    author.facebookUrl,
    author.instagramUrl,
  ].filter((url): url is string => !!url && url.trim() !== '')
}

/**
 * How complete an author's E-E-A-T signals are. Advisory only — it never
 * blocks saving, because every rule here has legitimate exceptions.
 */
export function seoCompleteness(author: Author): { score: number; total: number } {
  const checks = [
    !!author.jobTitle,
    !!author.credentials,
    !!author.bio,
    !!author.avatarKey,
    sameAsLinks(author).length > 0,
  ]
  return { score: checks.filter(Boolean).length, total: checks.length }
}

function CompletenessCell({ author }: { author: Author }) {
  const { score, total } = seoCompleteness(author)
  const variant = score === total ? 'success' : score >= 3 ? 'warning' : 'destructive'
  return (
    <ElementBadge variant={variant}>
      {score}/{total}
    </ElementBadge>
  )
}

export function buildColumns(
  onEdit: (row: Author) => void,
  onToggleActive: (row: Author) => void,
  onDelete: (row: Author) => void,
): ExtendedColumnDef<Author>[] {
  return [
    {
      id: 'name',
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.name}</span>
          {row.original.jobTitle && (
            <span className="text-xs text-muted-foreground">{row.original.jobTitle}</span>
          )}
        </div>
      ),
    },
    {
      id: 'slug',
      accessorKey: 'slug',
      header: 'Slug',
      cell: ({ getValue }) => (
        <span className="text-sm text-muted-foreground">{getValue() as string}</span>
      ),
    },
    {
      id: 'postCount',
      accessorKey: 'postCount',
      header: 'Posts',
      cell: ({ getValue }) => <span className="text-sm">{getValue() as number}</span>,
    },
    {
      id: 'seo',
      header: 'SEO Profile',
      cell: ({ row }) => <CompletenessCell author={row.original} />,
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
