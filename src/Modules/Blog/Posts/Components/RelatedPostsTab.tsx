'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, X } from 'lucide-react'
import BAPI from '@/Framework/API_Layer'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementToast from '@/components/shared/ElementToast/ElementToast'
import type { ExtendedColumnDef } from '@/components/shared/ElementTable/ElementTable.types'
import { BlogPostServices } from '../Services/BlogPostServices'

interface ApiResponse<T> { data: T; message: string | string[] }

/** The related-post block on the public page shows three. Six is enough slack
 *  to reorder without the last picks silently doing nothing. */
const MAX_RELATED = 6

interface RelatedRow extends Record<string, unknown> {
  id: string
  title: string
  slug: string
}

/**
 * Mirrors `BlogPostServices.getRelated` / `.setRelated`, kept local because
 * `RelatedRow` carries the `Record<string, unknown>` index signature
 * `ElementTable` requires and the service's `RelatedPostRef` does not. Reading
 * through the service would mean a cast at every row.
 */
async function fetchRelated(postId: string): Promise<RelatedRow[]> {
  const res = await BAPI.get<ApiResponse<RelatedRow[]>>(`/api/blog/posts/${postId}/related`, {
    showGlobalError: false,
    showGlobalSuccess: false,
  })
  return res.data
}

async function saveRelated(postId: string, ids: string[]): Promise<void> {
  await BAPI.put<ApiResponse<unknown>>(
    `/api/blog/posts/${postId}/related`,
    { relatedPostIds: ids },
    { showGlobalError: true, showGlobalSuccess: true }
  )
}

interface RelatedPostsTabProps {
  postId: string
  disabled?: boolean
}

export default function RelatedPostsTab({ postId, disabled }: RelatedPostsTabProps) {
  const queryClient = useQueryClient()
  // `null` means "untouched, showing whatever the server has". Any edit
  // promotes it to a concrete list — which also makes `isDirty` a derivation
  // rather than a second piece of state that can disagree with this one.
  const [edited, setEdited] = useState<RelatedRow[] | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(timer)
  }, [search])

  const { data: current, isLoading, isError } = useQuery({
    queryKey: ['blog-post-related', postId],
    queryFn: () => fetchRelated(postId),
    retry: false,
  })

  const selected = useMemo(() => edited ?? current ?? [], [edited, current])
  const isDirty = edited !== null

  const { data: candidates } = useQuery({
    queryKey: ['blog-posts-list', debouncedSearch, false],
    queryFn: () => BlogPostServices.list(debouncedSearch || undefined, false),
    enabled: debouncedSearch.length > 0,
  })

  const availableCandidates = useMemo(() => {
    const chosen = new Set(selected.map((row) => row.id))
    return (candidates ?? [])
      .filter((post) => post.id !== postId && !chosen.has(post.id))
      .slice(0, 8)
  }, [candidates, selected, postId])

  function add(row: RelatedRow) {
    if (selected.length >= MAX_RELATED) return
    setEdited([...selected, row])
  }

  const removeAt = useCallback(
    (id: string) => setEdited(selected.filter((row) => row.id !== id)),
    [selected]
  )

  async function handleSave() {
    setIsSaving(true)
    try {
      await saveRelated(postId, selected.map((row) => row.id))
      await queryClient.invalidateQueries({ queryKey: ['blog-post-related', postId] })
      setEdited(null)
    } catch {
      return
    } finally {
      setIsSaving(false)
    }
    ElementToast.success('Related posts updated.')
  }

  const columns: ExtendedColumnDef<RelatedRow>[] = useMemo(
    () => [
      {
        id: 'position',
        header: '#',
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.index + 1}</span>,
      },
      {
        id: 'title',
        accessorKey: 'title',
        header: 'Post',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.title}</span>
            <span className="text-xs text-muted-foreground">/blog/{row.original.slug}</span>
          </div>
        ),
      },
      {
        id: 'actions',
        header: '',
        alignRight: true,
        cell: ({ row }) => (
          <button
            type="button"
            disabled={disabled}
            onClick={() => removeAt(row.original.id)}
            className="text-muted-foreground transition-colors hover:text-destructive"
            title="Remove"
          >
            <X size={15} />
          </button>
        ),
      },
    ],
    [disabled, removeAt]
  )

  return (
    <div className="flex flex-col gap-4">
      {/* The behaviour people get wrong: this is a replacement, not an addition.
          Saying so here is cheaper than explaining a half-manual list later. */}
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-snug text-muted-foreground">
        <p className="font-medium text-foreground">Leaving this empty is the normal case.</p>
        <p className="mt-1">
          With nothing picked, related posts are chosen automatically from shared categories,
          tags and series, with cornerstone posts favoured. The moment you pick one here, the
          manual list <span className="font-medium text-foreground">replaces the automatic
          one entirely</span> — it does not top it up. Use it when you know something the
          scoring cannot, and clear it again to hand the job back.
        </p>
      </div>

      {isError && (
        <p className="text-xs text-muted-foreground">
          Could not load the current picks. Saving from here would overwrite them, so the save
          button stays disabled until it loads.
        </p>
      )}

      <ElementTable<RelatedRow>
        columns={columns}
        data={selected}
        loading={isLoading}
        loadingRows={3}
        emptyContent={<p>No manual picks — related posts are chosen automatically.</p>}
        onReorder={disabled ? undefined : (items) => setEdited(items)}
        syncSortWithUrl={false}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">
            Add a post ({selected.length} of {MAX_RELATED})
          </p>
          <ElementButton
            size="sm"
            onClick={handleSave}
            isLoading={isSaving}
            disabled={disabled || isError || !isDirty}
          >
            Save related posts
          </ElementButton>
        </div>

        <div className="relative max-w-md">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            disabled={disabled || selected.length >= MAX_RELATED}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={selected.length >= MAX_RELATED ? 'Six is the maximum' : 'Search posts by title'}
            className="h-9 w-full rounded-lg border border-input bg-background ps-8 pe-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
          />
        </div>

        {availableCandidates.length > 0 && (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background">
            {availableCandidates.map((post) => (
              <li key={post.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{post.title}</span>
                  <span className="truncate text-xs text-muted-foreground">/blog/{post.slug}</span>
                </div>
                <ElementButton
                  size="sm"
                  variant="outline"
                  disabled={disabled || selected.length >= MAX_RELATED}
                  onClick={() => add({ id: post.id, title: post.title, slug: post.slug })}
                >
                  <Plus size={13} />
                  Add
                </ElementButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
