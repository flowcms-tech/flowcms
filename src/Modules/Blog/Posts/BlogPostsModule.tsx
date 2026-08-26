'use client'

import { useAdminHref } from "@/Framework/Config/AdminPathProvider"
import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Search, Plus, Trash2, ArrowLeft, Network, PencilLine } from 'lucide-react'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ElementFilterBar from '@/components/shared/ElementFilterBar/ElementFilterBar'
import ElementToast from '@/components/shared/ElementToast/ElementToast'
import RedirectCreateDrawer from '@/Modules/Redirects/Components/RedirectCreateDrawer'
import type { Redirect } from '@/Modules/Redirects/Types'
import { BlogPostServices } from './Services/BlogPostServices'
import { buildColumns } from './Values/BlogPostValues'
import BulkEditDrawer from './Components/BulkEditDrawer'
import BlogClusterGraph from './Components/BlogClusterGraph'
import type { BlogPost } from './Types'

interface CurrentSession {
  user?: { id?: string }
}

/**
 * Not a dedicated endpoint — Auth.js already exposes this wherever its route
 * handlers are mounted (`/api/auth/[...nextauth]`), and it's the one place
 * in the app that answers "who am I" without wiring up a client-side
 * SessionProvider just for this one comparison.
 */
async function fetchCurrentSession(): Promise<CurrentSession> {
  const res = await fetch('/api/auth/session', { credentials: 'include' })
  return res.json()
}

interface SearchForm {
  search: string
}

export default function BlogPostsModule() {
  const adminHref = useAdminHref()
  const router = useRouter()
  const queryClient = useQueryClient()

  const [toggleTarget, setToggleTarget] = useState<BlogPost | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BlogPost | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<BlogPost | null>(null)
  const [purgeTarget, setPurgeTarget] = useState<BlogPost | null>(null)
  const [redirectTarget, setRedirectTarget] = useState<BlogPost | null>(null)
  const [showTrash, setShowTrash] = useState(false)
  const [showClusters, setShowClusters] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [bulkRows, setBulkRows] = useState<BlogPost[]>([])
  const [isBulkOpen, setIsBulkOpen] = useState(false)

  const methods = useForm<SearchForm>({ defaultValues: { search: '' } })
  const search = methods.watch('search')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(timer)
  }, [search])

  const { data, isLoading } = useQuery({
    queryKey: ['blog-posts-list', debouncedSearch, showTrash],
    queryFn: () => BlogPostServices.list(debouncedSearch || undefined, showTrash),
  })

  // Only used to tell "you have this open elsewhere" apart from "someone
  // else does" — a stale answer here just means a badge or a guard is off by
  // one poll interval, never a real safety gap: the PATCH/DELETE routes
  // enforce the lock server-side regardless of what this thinks.
  const { data: session } = useQuery({
    queryKey: ['current-admin-session'],
    queryFn: fetchCurrentSession,
    staleTime: 5 * 60 * 1000,
  })
  const currentUserId = session?.user?.id

  const posts = data ?? []

  /** True only when SOMEONE ELSE holds the lock — never blocks your own
   *  other tab, since there's nothing to protect against there. */
  function lockedByOther(row: BlogPost): boolean {
    return !!row.lockedBy && row.lockedBy.id !== currentUserId
  }

  /** Wraps a modal-opening setter so a locked post shows the message
   *  immediately instead of opening a confirm dialog that's just going to
   *  409. The PATCH/DELETE routes reject it either way — this only saves
   *  the extra click of dismissing that dialog afterward. */
  function guard(row: BlogPost, openModal: () => void) {
    if (lockedByOther(row)) {
      ElementToast.error(
        `"${row.title}" is currently being edited by ${row.lockedBy?.name || 'another admin'}. Try again once they're done.`
      )
      return
    }
    openModal()
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['blog-posts-list'] })

  const handleConfirmTogglePublished = async () => {
    if (!toggleTarget) return
    setActionLoading(true)
    try {
      await BlogPostServices.changePublished(toggleTarget.id, !toggleTarget.isPublished)
      await invalidate()
    } catch {
      return
    } finally {
      setActionLoading(false)
    }
    setToggleTarget(null)
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setActionLoading(true)
    try {
      await BlogPostServices.delete(deleteTarget.id)
      await invalidate()
    } catch {
      return
    } finally {
      setActionLoading(false)
    }
    setDeleteTarget(null)
  }

  const handleConfirmRestore = async () => {
    if (!restoreTarget) return
    setActionLoading(true)
    try {
      await BlogPostServices.restore(restoreTarget.id)
      await invalidate()
    } catch {
      return
    } finally {
      setActionLoading(false)
    }
    setRestoreTarget(null)
  }

  const handleConfirmPurge = async () => {
    if (!purgeTarget) return
    setActionLoading(true)
    try {
      await BlogPostServices.deletePermanently(purgeTarget.id)
      await invalidate()
    } catch {
      return
    } finally {
      setActionLoading(false)
    }
    setPurgeTarget(null)
  }

  const handleDuplicate = async (row: BlogPost) => {
    try {
      const copy = await BlogPostServices.duplicate(row.id)
      await invalidate()
      // Straight to the copy's edit screen: a duplicate is only ever the first
      // step of writing something else.
      router.push(adminHref(`/blog/posts/${copy.id}/edit`))
    } catch {
      // The BAPI error toast already said what happened.
    }
  }

  const columns = buildColumns(
    (row) => router.push(adminHref(`/blog/posts/${row.id}/edit`)),
    (row) => guard(row, () => setToggleTarget(row)),
    (row) => guard(row, () => setDeleteTarget(row)),
    (row) => guard(row, () => setRedirectTarget(row)),
    (row) => guard(row, () => handleDuplicate(row)),
    {
      isTrashView: showTrash,
      onRestore: (row) => guard(row, () => setRestoreTarget(row)),
      onPurge: (row) => guard(row, () => setPurgeTarget(row)),
    },
    currentUserId,
  )

  const header = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-sm">{showTrash ? 'Trash' : 'Blog Posts'}</p>
        <div className="flex items-center gap-2">
          {!showTrash && (
            <ElementButton
              size="sm"
              variant="outline"
              onClick={() => setShowClusters((v) => !v)}
            >
              <Network size={15} />
              {showClusters ? 'Back to List' : 'Cluster view'}
            </ElementButton>
          )}
          <ElementButton
            size="sm"
            variant="outline"
            onClick={() => { setShowTrash((v) => !v); setShowClusters(false) }}
          >
            {showTrash ? <ArrowLeft size={15} /> : <Trash2 size={15} />}
            {showTrash ? 'Back to Posts' : 'Trash'}
          </ElementButton>
          {!showTrash && (
            <ElementButton size="sm" onClick={() => router.push(adminHref('/blog/posts/create'))}>
              <Plus size={15} />
              New Post
            </ElementButton>
          )}
        </div>
      </div>
      {showTrash && (
        <p className="text-xs text-muted-foreground">
          Trashed posts are hidden from the site but nothing is deleted. Restore brings a post
          back as a draft.
        </p>
      )}
      <ElementFilterBar triggerLabel="Filters" activeCount={[debouncedSearch].filter(Boolean).length}>
        <FormProvider {...methods}>
          <form onSubmit={(e) => e.preventDefault()}>
            <ElementInput
              name="search"
              placeholder="Search by title"
              startIcon={<Search size={15} />}
              clearable
              classNames={{ root: 'w-full md:w-72' }}
            />
          </form>
        </FormProvider>
      </ElementFilterBar>
    </div>
  )

  return (
    <>
      <ElementModal.Confirm
        isOpen={toggleTarget !== null}
        onClose={(v) => { if (!v) setToggleTarget(null) }}
        variant="default"
        title={toggleTarget?.isPublished ? 'Unpublish Post' : 'Publish Post'}
        description={
          toggleTarget
            ? `Are you sure you want to ${toggleTarget.isPublished ? 'unpublish' : 'publish'} "${toggleTarget.title}"?`
            : undefined
        }
        confirmText="Confirm"
        cancelText="Cancel"
        isLoading={actionLoading}
        onConfirm={handleConfirmTogglePublished}
      />

      <ElementModal.Confirm
        isOpen={deleteTarget !== null}
        onClose={(v) => { if (!v) setDeleteTarget(null) }}
        variant="default"
        title="Move to Trash"
        description={
          deleteTarget
            ? `Move "${deleteTarget.title}" to the trash? It will be unpublished and hidden from the site, but nothing is deleted — you can restore it from the Trash view.`
            : undefined
        }
        confirmText="Move to Trash"
        cancelText="Cancel"
        isLoading={actionLoading}
        onConfirm={handleConfirmDelete}
      />

      <ElementModal.Confirm
        isOpen={restoreTarget !== null}
        onClose={(v) => { if (!v) setRestoreTarget(null) }}
        variant="default"
        title="Restore Post"
        description={
          restoreTarget
            ? `Restore "${restoreTarget.title}"? It comes back as a draft, so you choose when it goes live again.`
            : undefined
        }
        confirmText="Restore"
        cancelText="Cancel"
        isLoading={actionLoading}
        onConfirm={handleConfirmRestore}
      />

      <ElementModal.Confirm
        isOpen={purgeTarget !== null}
        onClose={(v) => { if (!v) setPurgeTarget(null) }}
        variant="danger"
        title="Delete Permanently"
        description={
          purgeTarget
            ? `Permanently delete "${purgeTarget.title}"? This also destroys its FAQs, category and tag links, and its entire revision history. This cannot be undone.`
            : undefined
        }
        confirmText="Delete Permanently"
        cancelText="Cancel"
        isLoading={actionLoading}
        onConfirm={handleConfirmPurge}
      />

      <RedirectCreateDrawer
        isOpen={redirectTarget !== null}
        setIsOpen={(open) => { if (!open) setRedirectTarget(null) }}
        initialFromPath={redirectTarget ? `/blog/${redirectTarget.slug}` : undefined}
        sourcePostIsLive={redirectTarget ? redirectTarget.isPublished && !redirectTarget.deletedAt : undefined}
        headerLabel={redirectTarget ? `Redirect "${redirectTarget.title}"` : undefined}
        onCreated={(created: Redirect) => {
          void created
          invalidate()
        }}
      />

      <BulkEditDrawer
        isOpen={isBulkOpen}
        setIsOpen={setIsBulkOpen}
        rows={bulkRows}
        onApplied={() => { invalidate() }}
      />

      {showClusters ? (
        <div className="flex flex-col rounded-xl border border-border bg-background shadow-sm">
          <div className="border-b border-border px-5 py-3">{header}</div>
          <BlogClusterGraph
            posts={posts}
            onOpen={(post) => router.push(adminHref(`/blog/posts/${post.id}/edit`))}
          />
        </div>
      ) : (
        <ElementTable<BlogPost>
          columns={columns}
          data={posts}
          loading={isLoading}
          loadingRows={5}
          headerContent={header}
          emptyContent={<p>No blog posts found</p>}
          // `bulkActionContent` alone turns on the checkbox column — the rows
          // arrive with the callback, so a second selection state here would
          // only be a copy that can drift.
          bulkActionContent={(rows, clearSelection) => (
            <ElementButton
              size="sm"
              variant="outline"
              onClick={() => {
                setBulkRows(rows)
                setIsBulkOpen(true)
                clearSelection()
              }}
            >
              <PencilLine size={14} />
              Bulk edit
            </ElementButton>
          )}
        />
      )}
    </>
  )
}
