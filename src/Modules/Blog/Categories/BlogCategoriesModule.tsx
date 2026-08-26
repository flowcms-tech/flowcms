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
import { BlogCategoryServices } from './Services/BlogCategoryServices'
import { buildColumns } from './Values/BlogCategoryValues'
import BlogCategoryCreateDrawer from './Components/BlogCategoryCreateDrawer'
import BlogCategoryEditDrawer from './Components/BlogCategoryEditDrawer'
import type { BlogCategory } from './Types'

interface SearchForm {
  search: string
}

export default function BlogCategoriesModule() {
  const queryClient = useQueryClient()

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<BlogCategory | null>(null)
  const [toggleTarget, setToggleTarget] = useState<BlogCategory | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BlogCategory | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const methods = useForm<SearchForm>({ defaultValues: { search: '' } })
  const search = methods.watch('search')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(timer)
  }, [search])

  const { data, isLoading } = useQuery({
    queryKey: ['blog-categories-list', debouncedSearch],
    queryFn: () => BlogCategoryServices.list(debouncedSearch || undefined),
  })

  const categories = data ?? []

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['blog-categories-list'] })

  const handleConfirmToggleActive = async () => {
    if (!toggleTarget) return
    setActionLoading(true)
    try {
      await BlogCategoryServices.changeActive(toggleTarget.id, !toggleTarget.isActive)
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
      await BlogCategoryServices.delete(deleteTarget.id)
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
        <p className="font-semibold text-sm">Blog Categories</p>
        <ElementButton size="sm" onClick={() => setIsCreateOpen(true)}>
          <Plus size={15} />
          New Category
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
      <BlogCategoryCreateDrawer
        isOpen={isCreateOpen}
        setIsOpen={setIsCreateOpen}
        categories={categories}
        onCreated={invalidate}
      />

      <BlogCategoryEditDrawer
        isOpen={editTarget !== null}
        setIsOpen={(open) => { if (!open) setEditTarget(null) }}
        category={editTarget}
        categories={categories}
        onUpdated={invalidate}
      />

      <ElementModal.Confirm
        isOpen={toggleTarget !== null}
        onClose={(v) => { if (!v) setToggleTarget(null) }}
        variant="default"
        title={toggleTarget?.isActive ? 'Deactivate Category' : 'Activate Category'}
        description={
          toggleTarget
            ? `Are you sure you want to ${toggleTarget.isActive ? 'deactivate' : 'activate'} category "${toggleTarget.name}"?`
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
        title="Delete Blog Category"
        description={deleteTarget ? `Are you sure you want to delete category "${deleteTarget.name}"? This action cannot be undone.` : undefined}
        confirmText="Delete"
        cancelText="Cancel"
        isLoading={actionLoading}
        onConfirm={handleConfirmDelete}
      />

      <ElementTable<BlogCategory>
        columns={columns}
        data={categories}
        loading={isLoading}
        loadingRows={5}
        headerContent={header}
        emptyContent={<p>No blog categories found</p>}
      />
    </>
  )
}
