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
import { BlogSeriesServices } from './Services/BlogSeriesServices'
import { buildColumns } from './Values/BlogSeriesValues'
import BlogSeriesCreateDrawer from './Components/BlogSeriesCreateDrawer'
import BlogSeriesEditDrawer from './Components/BlogSeriesEditDrawer'
import type { BlogSeries } from './Types'

interface SearchForm {
  search: string
}

export default function BlogSeriesModule() {
  const queryClient = useQueryClient()

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<BlogSeries | null>(null)
  const [toggleTarget, setToggleTarget] = useState<BlogSeries | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BlogSeries | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const methods = useForm<SearchForm>({ defaultValues: { search: '' } })
  const search = methods.watch('search')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(timer)
  }, [search])

  const { data, isLoading } = useQuery({
    queryKey: ['blog-series-list', debouncedSearch],
    queryFn: () => BlogSeriesServices.list(debouncedSearch || undefined),
  })

  const series = data ?? []

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['blog-series-list'] })

  const handleConfirmToggleActive = async () => {
    if (!toggleTarget) return
    setActionLoading(true)
    try {
      await BlogSeriesServices.changeActive(toggleTarget.id, !toggleTarget.isActive)
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
      await BlogSeriesServices.delete(deleteTarget.id)
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
        <p className="font-semibold text-sm">Blog Series</p>
        <ElementButton size="sm" onClick={() => setIsCreateOpen(true)}>
          <Plus size={15} />
          New Series
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
      <BlogSeriesCreateDrawer
        isOpen={isCreateOpen}
        setIsOpen={setIsCreateOpen}
        onCreated={invalidate}
      />

      <BlogSeriesEditDrawer
        isOpen={editTarget !== null}
        setIsOpen={(open) => { if (!open) setEditTarget(null) }}
        series={editTarget}
        onUpdated={invalidate}
      />

      <ElementModal.Confirm
        isOpen={toggleTarget !== null}
        onClose={(v) => { if (!v) setToggleTarget(null) }}
        variant="default"
        title={toggleTarget?.isActive ? 'Deactivate Series' : 'Activate Series'}
        description={
          toggleTarget
            ? `Are you sure you want to ${toggleTarget.isActive ? 'deactivate' : 'activate'} series "${toggleTarget.name}"?`
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
        title="Delete Series"
        description={
          deleteTarget
            ? `Delete series "${deleteTarget.name}"? ` +
              (deleteTarget.postCount > 0
                ? `Its ${deleteTarget.postCount} post${deleteTarget.postCount === 1 ? '' : 's'} will NOT be deleted — they are only unlinked from the series and lose their "Part N of M" navigation. `
                : '') +
              'This action cannot be undone.'
            : undefined
        }
        confirmText="Delete"
        cancelText="Cancel"
        isLoading={actionLoading}
        onConfirm={handleConfirmDelete}
      />

      <ElementTable<BlogSeries>
        columns={columns}
        data={series}
        loading={isLoading}
        loadingRows={5}
        headerContent={header}
        emptyContent={<p>No blog series found</p>}
      />
    </>
  )
}
