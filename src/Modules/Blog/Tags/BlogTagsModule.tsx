'use client'

import { useEffect, useState } from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Plus } from 'lucide-react'
import ElementTable from '@/components/shared/ElementTable/ElementTable'
import ElementInput from '@/components/shared/ElementInput/ElementInput'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import ElementModal from '@/components/shared/ElementModal/ElementModal'
import ElementFilterBar from '@/components/shared/ElementFilterBar/ElementFilterBar'
import { BlogTagServices } from './Services/BlogTagServices'
import { buildColumns } from './Values/BlogTagValues'
import BlogTagCreateDrawer from './Components/BlogTagCreateDrawer'
import BlogTagEditDrawer from './Components/BlogTagEditDrawer'
import type { BlogTag } from './Types'

interface SearchForm {
  search: string
}

/** An empty tag is both the safest delete and the one most worth making — it is
 *  a thin archive nothing links to. Naming that in the confirmation turns "are
 *  you sure?" into an actual decision. */
function describeDelete(tag: BlogTag): string {
  if (tag.postCount === 0) {
    return `Tag "${tag.name}" has no published posts, so its archive is an empty page nothing links to. Delete it? This action cannot be undone.`
  }
  const posts = tag.postCount === 1 ? '1 published post' : `${tag.postCount} published posts`
  return `Are you sure you want to delete tag "${tag.name}"? It is on ${posts}, which will lose it. This action cannot be undone.`
}

export default function BlogTagsModule() {
  const queryClient = useQueryClient()

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<BlogTag | null>(null)
  const [toggleTarget, setToggleTarget] = useState<BlogTag | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BlogTag | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const methods = useForm<SearchForm>({ defaultValues: { search: '' } })
  const search = methods.watch('search')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(timer)
  }, [search])

  const { data, isLoading } = useQuery({
    queryKey: ['blog-tags-list', debouncedSearch],
    queryFn: () => BlogTagServices.list(debouncedSearch || undefined),
  })

  const tags = data ?? []

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['blog-tags-list'] })

  const handleConfirmToggleActive = async () => {
    if (!toggleTarget) return
    setActionLoading(true)
    try {
      await BlogTagServices.changeActive(toggleTarget.id, !toggleTarget.isActive)
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
      await BlogTagServices.delete(deleteTarget.id)
      await invalidate()
    } catch {
      return
    } finally {
      setActionLoading(false)
    }
    setDeleteTarget(null)
  }

  const columns = buildColumns(setEditTarget, setToggleTarget, setDeleteTarget)

  const header = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-sm">Blog Tags</p>
        <ElementButton size="sm" onClick={() => setIsCreateOpen(true)}>
          <Plus size={15} />
          New Tag
        </ElementButton>
      </div>
      <ElementFilterBar triggerLabel="Filters" activeCount={[debouncedSearch].filter(Boolean).length}>
        <FormProvider {...methods}>
          <form onSubmit={(e) => e.preventDefault()}>
            <ElementInput
              name="search"
              placeholder="Search by name"
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
      <BlogTagCreateDrawer
        isOpen={isCreateOpen}
        setIsOpen={setIsCreateOpen}
        onCreated={invalidate}
      />

      <BlogTagEditDrawer
        isOpen={editTarget !== null}
        setIsOpen={(open) => { if (!open) setEditTarget(null) }}
        tag={editTarget}
        onUpdated={invalidate}
      />

      <ElementModal.Confirm
        isOpen={toggleTarget !== null}
        onClose={(v) => { if (!v) setToggleTarget(null) }}
        variant="default"
        title={toggleTarget?.isActive ? 'Deactivate Tag' : 'Activate Tag'}
        description={
          toggleTarget
            ? `Are you sure you want to ${toggleTarget.isActive ? 'deactivate' : 'activate'} tag "${toggleTarget.name}"?`
            : undefined
        }
        confirmText="Confirm"
        cancelText="Cancel"
        isLoading={actionLoading}
        onConfirm={handleConfirmToggleActive}
      />

      <ElementModal.Confirm
        isOpen={deleteTarget !== null}
        onClose={(v) => { if (!v) setDeleteTarget(null) }}
        variant="danger"
        title="Delete Blog Tag"
        description={deleteTarget ? describeDelete(deleteTarget) : undefined}
        confirmText="Delete"
        cancelText="Cancel"
        isLoading={actionLoading}
        onConfirm={handleConfirmDelete}
      />

      <ElementTable<BlogTag>
        columns={columns}
        data={tags}
        loading={isLoading}
        loadingRows={5}
        headerContent={header}
        emptyContent={<p>No blog tags found</p>}
      />
    </>
  )
}
